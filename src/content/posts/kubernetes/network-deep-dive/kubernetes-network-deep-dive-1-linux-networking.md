---
title: "쿠버네티스 Deep Dive - 네트워크 편 1 | Linux 네트워크 기초"
published: 2026-05-13
description: "Kubernetes의 Pod, CNI, Service를 이해하기 전에 필요한 Linux 네트워크 기본 요소인 network namespace, veth pair, bridge, routing, NAT, conntrack을 패킷 흐름 중심으로 정리합니다."
image: "/assets/series/kubernetes-network-deep-dive.png"
tags: ["Kubernetes", "Network", "Linux", "CNI", "Namespace", "veth", "Bridge", "NAT"]
category: "Kubernetes"
draft: false
lang: "ko"
cropCover: false
coverLayout: "wide"
series: "kubernetes-network-deep-dive"
seriesOrder: 1
---
Kubernetes 네트워크를 깊게 이해하려면, 먼저 Kubernetes가 의존하고 있는 Linux 네트워크 동작을 잡아야 한다.

`Pod IP`, `ClusterIP`, `Service`, `EndpointSlice`, `kube-proxy`, `CNI`, `Ingress`, `Gateway`, `NetworkPolicy` 같은 개념은 각각 다른 추상화처럼 보이지만, 실제 패킷 흐름을 따라가면 결국 Linux 커널의 네트워크 기능 위에서 움직인다.

- Pod는 왜 각자 IP를 가질까?
- 같은 Pod 안의 container끼리는 왜 `localhost`로 통신할까?
- 같은 노드의 Pod끼리는 어떻게 통신할까?
- 다른 노드의 Pod끼리는 어떤 경로로 통신할까?
- Service IP는 실제로 어디로 연결될까?
- CNI는 정확히 어떤 일을 맡고 있을까?
- kube-proxy는 패킷 흐름에서 어떤 역할을 할까?

이 질문들에 답하려면 Kubernetes 리소스 이름만 외워서는 부족하다. Kubernetes가 만들어내는 추상화 아래에서 Linux가 패킷을 어떻게 격리하고, 연결하고, 전달하고, 변환하는지 알아야 한다.

이번 글은 그 출발점으로 Linux 네트워크의 핵심 요소를 정리한다.

`network namespace`, `veth pair`, `bridge`, `routing table`, `NAT`, `conntrack`을 먼저 이해하면 이후 `Pod network`, `CNI`, `Service proxy`, `EndpointSlice` 같은 Kubernetes 개념을 훨씬 자연스럽게 연결할 수 있다.

즉 1편의 목표는 Kubernetes 네트워크를 바로 설명하는 것이 아니라, Kubernetes 네트워크를 이해하기 위한 Linux 네트워크 기반을 만드는 것이다.

다룰 내용은 다음과 같다.

1. `network namespace`
2. `veth pair`
3. `Linux bridge`
4. `routing`
5. `NAT`
6. `conntrack`

이 기반을 잡아두면 이후 글에서 `Pod IP`, `CNI`, `Service`, `EndpointSlice`, `kube-proxy`를 훨씬 덜 막히고 이해할 수 있다.

## 01. Kubernetes 네트워크는 결국 Linux 네트워크다

먼저 관점을 하나 잡고 가자.

> Kubernetes의 네트워크 모델은 Linux 커널의 네트워크 기능 위에서 구현된다.

Kubernetes는 우리에게 `Pod`, `Service`, `Ingress`, `Gateway`, `NetworkPolicy` 같은 API 리소스를 보여준다. 하지만 실제 패킷은 Kubernetes 리소스 이름을 보고 움직이지 않는다.

패킷은 결국 노드의 Linux 커널 안에서 다음 질문들에 따라 처리된다.

- 이 패킷은 어떤 network namespace 안에 있는가?
- 어떤 interface로 나가야 하는가?
- 목적지 IP는 같은 L2 네트워크에 있는가?
- route table에는 어떤 next hop이 등록되어 있는가?
- bridge에 연결된 다른 interface로 전달할 수 있는가?
- NAT 규칙에 의해 출발지나 목적지가 바뀌어야 하는가?
- NAT 이후 응답 패킷을 어떤 연결 상태로 되돌려야 하는가?

즉 Kubernetes 네트워크를 이해한다는 것은, **Kubernetes API가 만들어낸 추상화가 Linux의 어떤 네트워크 동작으로 구현되는지 이해하는 것**에 가깝다.

`Pod network`, `Service proxy`, `EndpointSlice`, `CNI plugin` 같은 표현은 추상적인 Kubernetes 용어처럼 보이지만, 그 뒤에는 결국 namespace, interface, route, NAT, conntrack 같은 Linux 개념이 숨어 있다.

## 02. network namespace: 격리된 네트워크 공간

`network namespace`는 Linux가 제공하는 네트워크 격리 기능이다.

하나의 Linux 서버 안에서도 network namespace를 나누면, 각 namespace는 서로 독립적인 네트워크 환경을 가진다.

각 namespace는 다음과 같은 것들을 독립적으로 가진다.

- network interface
- IP address
- routing table
- ARP table
- iptables 규칙
- conntrack table
- loopback interface

쉽게 말하면 network namespace는 **네트워크 관점에서 분리된 작은 Linux 환경**이다.

예를 들어 `pod-a`라는 namespace와 `pod-b`라는 namespace가 있다고 해보자.

```bash
sudo ip netns add pod-a
sudo ip netns add pod-b
```

두 namespace는 같은 호스트 안에 있지만 네트워크 관점에서는 서로 분리되어 있다.

```bash
sudo ip netns exec pod-a ip addr
sudo ip netns exec pod-b ip addr
```

각 namespace 안에서 `ip addr`를 실행하면 서로 다른 interface 목록을 보게 된다. `pod-a` 안에서 보이는 interface와 `pod-b` 안에서 보이는 interface는 기본적으로 공유되지 않는다.

이 개념이 Kubernetes의 Pod를 이해하는 첫 번째 열쇠다.

Kubernetes에서 Pod는 자신만의 network namespace를 가진다. 그리고 같은 Pod 안의 여러 container는 이 network namespace를 공유한다. 그래서 같은 Pod 안의 container끼리는 `localhost`로 통신할 수 있다.

정리하면 다음과 같다.

- container 하나마다 무조건 network namespace가 따로 생기는 것이 아니다.
- Kubernetes에서는 Pod 단위로 network namespace가 만들어진다.
- 같은 Pod 안의 container들은 같은 IP, 같은 port 공간, 같은 loopback interface를 공유한다.

그래서 Kubernetes에서 네트워크의 기본 단위는 container가 아니라 Pod다.

## 03. veth pair: namespace를 연결하는 가상 케이블

network namespace는 격리된 공간이다. 격리되어 있다는 말은, 아무 연결도 하지 않으면 바깥과 통신할 수 없다는 뜻이다.

그렇다면 host namespace와 Pod namespace는 어떻게 연결될까?

여기서 `veth pair`가 등장한다.

`veth pair`는 이름 그대로 pair로 만들어지는 가상 네트워크 interface다. 한쪽으로 들어간 패킷은 반대쪽으로 나온다. 그래서 보통 **가상 랜 케이블**처럼 생각하면 이해하기 쉽다.

예를 들어 다음과 같은 구조를 만들 수 있다.

```text
host namespace                    pod-a namespace
+-------------+                   +--------------+
| veth-a-host | <---------------> | eth0         |
+-------------+                   +--------------+
```

host 쪽에는 `veth-a-host`가 있고, Pod namespace 안에는 `eth0`가 있다. `pod-a` 안에서 `eth0`로 패킷을 내보내면 host 쪽 `veth-a-host`로 나온다. 반대로 host 쪽 `veth-a-host`로 들어간 패킷은 `pod-a` 안의 `eth0`로 들어간다.

직접 만든다면 대략 이런 형태다.

```bash
sudo ip netns add pod-a
sudo ip link add veth-a-host type veth peer name eth0 netns pod-a

sudo ip addr add 10.200.0.11/24 dev veth-a-host
sudo ip link set veth-a-host up

sudo ip netns exec pod-a ip addr add 10.200.0.12/24 dev eth0
sudo ip netns exec pod-a ip link set eth0 up
sudo ip netns exec pod-a ip link set lo up
```

실제 Kubernetes에서는 우리가 이 명령을 직접 실행하지 않는다. CNI plugin이 Pod가 생성될 때 이런 작업을 자동으로 수행한다.

여기서 중요한 점은 다음이다.

> Pod의 `eth0`는 갑자기 생긴 마법 같은 장치가 아니라, host 쪽 veth와 연결된 가상 interface다.

이제 Pod가 바깥으로 패킷을 보낼 길이 생겼다. 하지만 Pod가 여러 개라면 veth를 어떻게 서로 연결해야 할까?

## 04. Linux bridge: 여러 interface를 묶는 가상 스위치

Pod가 하나만 있다면 host와 veth pair 하나로 연결하면 된다. 하지만 한 노드에는 보통 여러 Pod가 올라간다.

예를 들어 같은 노드에 `pod-a`, `pod-b`, `pod-c`가 있다고 해보자. 각 Pod는 자기 network namespace 안의 `eth0`를 가지고 있고, host 쪽에는 각각의 veth interface가 생긴다.

이 host 쪽 veth들을 한 곳에 모아 연결하려면 `Linux bridge`를 사용할 수 있다.

Linux bridge는 커널 안에서 동작하는 가상 L2 스위치다.

```text
                  host namespace

             +------------------+
             |      br0         |
             |  Linux bridge    |
             +---+----------+---+
                 |          |
           veth-a-host  veth-b-host
                 |          |
              eth0       eth0
             pod-a      pod-b
```

bridge에 여러 interface를 붙이면, 같은 L2 네트워크에 연결된 것처럼 통신할 수 있다. 실제 스위치처럼 MAC address를 학습하고, 목적지 MAC address에 따라 적절한 포트로 frame을 전달한다.

간단한 실습 구조는 다음처럼 만들 수 있다.

```bash
sudo ip netns add pod-a
sudo ip netns add pod-b

sudo ip link add br0 type bridge
sudo ip addr add 10.200.0.1/24 dev br0
sudo ip link set br0 up

sudo ip link add veth-a-host type veth peer name eth0 netns pod-a
sudo ip link add veth-b-host type veth peer name eth0 netns pod-b

sudo ip link set veth-a-host master br0
sudo ip link set veth-b-host master br0
sudo ip link set veth-a-host up
sudo ip link set veth-b-host up

sudo ip netns exec pod-a ip addr add 10.200.0.11/24 dev eth0
sudo ip netns exec pod-a ip link set eth0 up
sudo ip netns exec pod-a ip link set lo up

sudo ip netns exec pod-b ip addr add 10.200.0.12/24 dev eth0
sudo ip netns exec pod-b ip link set eth0 up
sudo ip netns exec pod-b ip link set lo up
```

이제 `pod-a`에서 `pod-b`로 ping을 보내볼 수 있다.

```bash
sudo ip netns exec pod-a ping -c 2 10.200.0.12
```

이때 패킷 흐름은 대략 다음과 같다.

```text
pod-a eth0
  -> veth-a-host
  -> br0
  -> veth-b-host
  -> pod-b eth0
```

같은 노드 안의 Pod끼리 통신하는 흐름을 이해할 때 이 그림이 중요하다.

물론 모든 CNI plugin이 Linux bridge만 사용하는 것은 아니다. 어떤 CNI는 bridge 기반으로 구성하고, 어떤 CNI는 routing을 더 적극적으로 사용하며, 어떤 CNI는 overlay network를 사용한다. 하지만 어떤 방식이든 핵심은 같다.

> Pod의 network namespace와 host의 네트워크를 연결하고, Pod IP로 패킷이 오갈 수 있는 경로를 만든다.

## 05. routing: 목적지까지 가는 다음 길을 고르는 일

bridge가 같은 L2 네트워크 안에서 frame을 전달한다면, routing은 L3에서 IP 패킷의 다음 목적지를 결정한다.

Linux에서 route table은 다음 명령으로 확인할 수 있다.

```bash
ip route
```

namespace 안에서도 독립적인 route table을 가진다.

```bash
sudo ip netns exec pod-a ip route
```

예를 들어 `pod-a` 안에 다음과 같은 route가 있다고 해보자.

```text
10.200.0.0/24 dev eth0 proto kernel scope link src 10.200.0.11
default via 10.200.0.1 dev eth0
```

이 route table은 이렇게 해석할 수 있다.

- `10.200.0.0/24` 대역은 `eth0`로 직접 보낸다.
- 그 외의 목적지는 `10.200.0.1`을 gateway로 삼아 `eth0`로 보낸다.

Pod가 같은 대역의 다른 Pod로 패킷을 보낼 때는 직접 보낼 수 있다. 하지만 외부 네트워크로 나가려면 default gateway가 필요하다.

```bash
sudo ip netns exec pod-a ip route add default via 10.200.0.1
```

그리고 host가 namespace에서 나온 패킷을 다른 interface로 전달하려면 IP forwarding이 켜져 있어야 한다.

```bash
sudo sysctl -w net.ipv4.ip_forward=1
```

Kubernetes에서도 routing은 매우 중요하다. 특히 다른 노드에 있는 Pod와 통신하려면 다음 질문에 답할 수 있어야 한다.

> 이 Pod IP 대역으로 가려면 어느 노드로 패킷을 보내야 하는가?

CNI plugin은 이 경로를 만들기 위해 여러 방식을 사용한다.

- 각 노드에 Pod CIDR route를 등록한다.
- overlay network를 만들어 노드 간 터널을 구성한다.
- 클라우드 라우팅 테이블과 연동한다.
- eBPF를 사용해 커널 datapath를 직접 구성한다.

방식은 달라도 목표는 같다.

> 어떤 노드에 있는 Pod IP든, 목적지 Pod까지 패킷이 도달할 수 있는 경로를 만든다.

## 06. NAT: 패킷의 출발지나 목적지를 바꾸는 일

`NAT`는 Network Address Translation의 약자다. 말 그대로 패킷의 주소를 바꾸는 기능이다.

NAT에는 대표적으로 두 가지가 있다.

- `SNAT`: Source NAT, 출발지 주소를 바꾼다.
- `DNAT`: Destination NAT, 목적지 주소를 바꾼다.

### SNAT

Pod가 클러스터 밖의 인터넷으로 나간다고 생각해보자.

Pod IP가 `10.200.0.11`이라고 해도, 외부 인터넷은 이 사설 Pod IP로 응답을 돌려보내는 방법을 모를 수 있다. 그래서 노드 밖으로 나갈 때 출발지 IP를 노드의 IP로 바꿔야 할 수 있다.

이때 사용하는 것이 SNAT 또는 MASQUERADE다.

```bash
sudo iptables -t nat -A POSTROUTING -s 10.200.0.0/24 -o eth0 -j MASQUERADE
```

패킷의 출발지가 `10.200.0.11`에서 노드 IP로 바뀌고, 응답이 돌아오면 conntrack 정보를 바탕으로 다시 원래 Pod IP로 되돌려진다.

### DNAT

반대로 목적지 주소를 바꾸는 경우도 있다.

Kubernetes Service를 떠올려보자. 사용자는 `ClusterIP`로 요청을 보낸다. 하지만 실제 응답을 처리하는 것은 Service 자체가 아니라 뒤에 있는 Pod들이다.

이때 노드 안의 네트워크 규칙은 목적지를 Service IP에서 실제 Pod IP로 바꿀 수 있다. 이것이 DNAT의 전형적인 형태다.

```text
client -> Service IP:80
              |
              | DNAT
              v
          Pod IP:8080
```

Kubernetes의 Service를 이해하려면 이 관점이 중요하다.

> Service IP는 보통 특정 interface에 붙어 있는 실제 서버 IP라기보다, 커널의 패킷 처리 규칙을 통해 Pod IP로 연결되는 가상 진입점에 가깝다.

이후 Service 편에서 `ClusterIP`, `EndpointSlice`, `kube-proxy`, `iptables`, `IPVS`를 다시 볼 때 이 DNAT 개념이 핵심이 된다.

## 07. Kubernetes에 다시 연결해보기

지금까지 본 Linux 요소들을 Kubernetes에 연결하면 다음과 같다.

| Linux 개념 | Kubernetes에서의 의미 |
| --- | --- |
| network namespace | Pod가 가지는 격리된 네트워크 공간 |
| veth pair | Pod namespace와 host network를 잇는 가상 케이블 |
| Linux bridge | 같은 노드의 여러 Pod를 연결하는 방식 중 하나 |
| routing table | Pod IP 대역으로 가는 경로를 결정하는 정보 |
| NAT | Service IP를 Pod IP로 바꾸거나, Pod egress 출발지를 바꾸는 데 사용 |
| conntrack | NAT 이후 응답 패킷을 원래 연결로 되돌리는 상태 추적 |

이제 처음 질문으로 돌아가보자.

### Pod는 왜 각자 IP를 가질까?

Kubernetes의 네트워크 모델은 Pod를 하나의 네트워크 주체로 본다. 각 Pod가 IP를 가지면, 애플리케이션은 다른 Pod를 하나의 독립된 endpoint처럼 다룰 수 있다.

### 같은 Pod 안의 container끼리는 왜 localhost로 통신할까?

같은 Pod 안의 container들이 같은 network namespace를 공유하기 때문이다. 즉 같은 loopback interface와 port 공간을 바라본다.

### 같은 노드의 Pod끼리는 어떻게 통신할까?

CNI가 Pod namespace와 host를 veth pair로 연결하고, bridge나 routing을 통해 Pod IP 간 통신 경로를 만든다.

### 다른 노드의 Pod끼리는 어떻게 통신할까?

각 노드의 Pod CIDR로 가는 route가 필요하다. 이 route는 CNI plugin이 구성한다. 경우에 따라 underlay routing을 쓰기도 하고, VXLAN 같은 overlay tunnel을 쓰기도 한다.

### Service는 왜 필요한가?

Pod IP는 계속 바뀔 수 있다. Pod가 재시작되거나 다른 노드에 다시 생성되면 IP가 달라질 수 있다. Service는 변하는 Pod들 앞에 안정적인 진입점을 제공하고, 그 뒤의 실제 Pod 목록으로 트래픽을 전달한다.

## 08. Kubernetes 개념에 다시 연결하기

이번 글에서 본 Linux 개념은 이후 Kubernetes 네트워크를 볼 때 계속 다시 등장한다.

- `network namespace`는 각 Pod가 독립된 네트워크 공간을 갖는 기반이다.
- `veth pair`는 각 Pod의 `eth0`와 host network를 이어주는 가상 케이블로 볼 수 있다.
- `bridge`와 `routing`은 같은 노드 또는 다른 노드의 Pod 사이에 통신 경로를 만든다.
- `NAT`와 `conntrack`은 Service IP가 실제 Pod IP로 연결되는 흐름을 이해할 때 중요하다.
- 이 요소들 위에서 CNI는 Pod network를 구성하고, kube-proxy는 Service 트래픽을 backend Pod로 보내는 dataplane을 만든다.

결국 중요한 것은 패킷의 이동 경로를 상상할 수 있는가이다. 어떤 추상화를 만나더라도, 그 아래에서 Linux가 어떤 방식으로 패킷을 처리하는지 떠올릴 수 있으면 Kubernetes 네트워크를 훨씬 안정적으로 이해할 수 있다.

## 09. 이번 편의 핵심 정리

이번 글에서는 Kubernetes 네트워크를 바로 보기 전에 Linux 네트워크의 기본 요소를 먼저 정리했다.

핵심은 다음과 같다.

- Kubernetes 네트워크는 Linux 커널의 네트워크 기능 위에 만들어진다.
- Pod는 network namespace를 가진다.
- 같은 Pod 안의 container들은 network namespace를 공유한다.
- veth pair는 Pod namespace와 host namespace를 연결한다.
- Linux bridge는 여러 veth를 묶어 같은 L2 네트워크처럼 연결할 수 있다.
- routing은 목적지 IP까지 가는 다음 경로를 결정한다.
- NAT는 Service나 외부 통신 흐름을 이해할 때 핵심이 된다.
- conntrack은 NAT 이후 응답 패킷을 원래 연결 흐름으로 되돌리는 데 필요하다.

이 글에서 가장 중요한 문장은 하나다.

> Kubernetes 네트워크를 이해하려면, 먼저 Linux가 패킷을 어떻게 전달하는지 이해해야 한다.

다음 편에서는 이 기반 위에서 Kubernetes Network Model과 CNI를 본격적으로 연결해볼 것이다. `Pod IP`, `Pod network`, `pause container`, `eth0`, `CNI`가 어떤 관계를 가지는지 이어서 정리해보자.
