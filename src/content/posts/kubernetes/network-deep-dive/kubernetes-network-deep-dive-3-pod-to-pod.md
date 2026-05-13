---
title: "쿠버네티스 Deep Dive - 네트워크 편 3 | Pod-to-Pod 통신"
published: 2026-05-13
description: "같은 노드와 다른 노드에 있는 Pod들이 어떤 경로로 통신하는지 veth, bridge, routing, overlay 관점에서 정리합니다."
image: "/assets/series/kubernetes-network-deep-dive.png"
tags: ["Kubernetes", "Network", "Pod", "Routing", "Overlay", "VXLAN"]
category: "Kubernetes"
draft: true
lang: "ko"
cropCover: false
coverLayout: "wide"
series: "kubernetes-network-deep-dive"
seriesOrder: 3
---

앞선 글에서는 Pod가 하나의 네트워크 주체처럼 동작하고, CNI가 Pod network를 구성한다는 점을 살펴봤다.

이제 다음 질문으로 넘어가자.

> Pod에서 보낸 패킷은 실제로 어떤 경로를 지나 다른 Pod에 도착할까?

이 질문은 Kubernetes 네트워크를 이해할 때 가장 중요한 질문 중 하나다.

Pod-to-Pod 통신은 크게 두 가지로 나눌 수 있다.

1. 같은 노드에 있는 Pod끼리의 통신
2. 서로 다른 노드에 있는 Pod끼리의 통신

둘 다 출발점은 Pod의 `eth0`이지만, host namespace로 나온 뒤의 경로가 달라진다.

## 01. 먼저 전체 그림 잡기

두 Pod가 있다고 해보자.

```text
pod-a: 10.244.1.10
pod-b: 10.244.1.20
```

둘이 같은 노드에 있다면 패킷은 대략 다음 흐름을 따른다.

```text
pod-a eth0
  → veth
  → host network
  → bridge or routing
  → veth
  → pod-b eth0
```

서로 다른 노드에 있다면 중간에 node network가 추가된다.

```text
pod-a eth0
  → node-a host network
  → node-a physical interface
  → network between nodes
  → node-b physical interface
  → node-b host network
  → pod-b eth0
```

여기서 CNI가 어떤 방식을 쓰느냐에 따라 `bridge`, `route`, `overlay tunnel`, `eBPF forwarding` 같은 구현 차이가 생긴다.

하지만 큰 질문은 같다.

- source Pod의 패킷은 host로 어떻게 나오는가?
- host는 destination Pod IP를 보고 어디로 보내는가?
- destination node는 패킷을 어떤 Pod로 전달하는가?

## 02. 같은 노드 Pod 통신

먼저 같은 노드 안에 있는 두 Pod를 보자.

```text
node-1
├── pod-a: 10.244.1.10
└── pod-b: 10.244.1.20
```

`pod-a`에서 `pod-b`로 요청을 보낸다.

```bash
curl http://10.244.1.20:8080
```

Pod 안에서 보면 단순한 IP 통신이다. 하지만 실제로는 다음 단계가 일어난다.

1. `pod-a`의 application이 destination IP `10.244.1.20`으로 패킷을 만든다.
2. `pod-a`의 routing table이 next hop 또는 output interface를 결정한다.
3. 패킷이 `pod-a`의 `eth0`로 나간다.
4. veth pair를 통해 host namespace의 veth interface로 들어온다.
5. host network에서 bridge 또는 route를 통해 `pod-b` 쪽 veth로 전달된다.
6. `pod-b`의 `eth0`로 패킷이 들어간다.
7. `pod-b`의 application이 패킷을 받는다.

이때 가장 중요한 것은 Pod의 `eth0`가 host 쪽 veth와 연결되어 있다는 점이다.

```text
pod-a ns                    host ns                     pod-b ns
eth0 ── veth pair ── veth-a ── bridge/route ── veth-b ── eth0
```

Pod 안에서 보이는 `eth0`는 실제 물리 NIC가 아니다. host 쪽 interface와 쌍을 이루는 가상 interface다.

## 03. bridge 기반 흐름

일부 CNI 구현 또는 단순한 실습 환경에서는 Linux bridge가 같은 노드 Pod들을 연결한다.

그림은 다음과 비슷하다.

```text
node-1
┌────────────────────────────────────┐
│ host namespace                     │
│                                    │
│  cni0 bridge                       │
│   ├── veth-a ── pod-a eth0         │
│   └── veth-b ── pod-b eth0         │
│                                    │
└────────────────────────────────────┘
```

bridge는 L2 switch처럼 동작한다. 여러 veth interface가 같은 bridge에 붙어 있으면, bridge는 MAC 주소를 기준으로 frame을 전달한다.

이 경우 같은 노드의 Pod들은 같은 L2 segment에 있는 것처럼 통신할 수 있다.

Pod는 destination IP가 같은 subnet 안에 있다고 판단하면 ARP로 destination MAC을 찾으려 한다. ARP 요청은 bridge를 통해 전달되고, destination Pod가 응답하면 이후 패킷은 해당 MAC으로 전달된다.

흐름을 정리하면 다음과 같다.

```text
pod-a
  → ARP: 10.244.1.20의 MAC은?
  → bridge
  → pod-b 응답
  → pod-a가 pod-b MAC으로 frame 전송
  → bridge가 veth-b로 전달
```

이 모델은 직관적이다. 다만 모든 CNI가 bridge 중심으로 동작하는 것은 아니다.

## 04. routing 기반 흐름

어떤 CNI는 bridge보다 routing을 중심으로 Pod 간 통신을 처리한다.

이 경우 host는 각 Pod IP 또는 Pod CIDR에 대한 route를 알고 있다.

예를 들어 같은 노드 안에서 다음과 같은 route가 있을 수 있다.

```text
10.244.1.10 dev veth-a
10.244.1.20 dev veth-b
```

source Pod에서 나온 패킷은 host namespace로 들어오고, host는 routing table을 보고 destination Pod로 가는 interface를 선택한다.

```text
pod-a eth0
  → host veth-a
  → host route lookup
  → host veth-b
  → pod-b eth0
```

bridge 방식과 routing 방식은 구현이 다르지만, 이해해야 하는 관점은 같다.

> host network가 Pod namespace 사이의 패킷 전달자 역할을 한다.

Pod는 독립된 network namespace 안에 있으므로, 결국 host namespace를 통해 다른 namespace로 연결된다.

## 05. 다른 노드 Pod 통신

이제 더 중요한 경우를 보자.

```text
node-1
└── pod-a: 10.244.1.10

node-2
└── pod-b: 10.244.2.20
```

`pod-a`가 `pod-b`로 요청을 보낸다.

```bash
curl http://10.244.2.20:8080
```

출발은 같은 노드 통신과 비슷하다.

1. `pod-a`가 destination IP `10.244.2.20`으로 패킷을 만든다.
2. 패킷이 `pod-a eth0`를 통해 host namespace로 나온다.
3. node-1은 `10.244.2.20`이 로컬 Pod가 아니라는 것을 안다.
4. node-1은 destination Pod IP가 있는 node-2로 패킷을 보낸다.
5. node-2는 패킷을 받아 `pod-b`로 전달한다.

여기서 핵심 질문은 이것이다.

> node-1은 10.244.2.20이 node-2 뒤에 있다는 것을 어떻게 알까?

답은 CNI 구현에 따라 달라진다.

## 06. Pod CIDR과 노드별 경로

많은 클러스터에서는 노드마다 Pod IP 대역이 할당된다.

예를 들어 다음과 같다.

```text
node-1 Pod CIDR: 10.244.1.0/24
node-2 Pod CIDR: 10.244.2.0/24
node-3 Pod CIDR: 10.244.3.0/24
```

이 구조에서는 `10.244.2.20`이 `10.244.2.0/24`에 속하므로 node-2로 보내야 한다는 판단을 할 수 있다.

node-1의 route table은 다음과 비슷할 수 있다.

```text
10.244.1.0/24 dev cni0
10.244.2.0/24 via 192.168.10.12 dev eth0
10.244.3.0/24 via 192.168.10.13 dev eth0
```

여기서 `192.168.10.12`는 node-2의 node IP다.

이 경우 패킷 흐름은 다음과 같다.

```text
pod-a: 10.244.1.10
  → node-1
  → route lookup: 10.244.2.0/24는 node-2로
  → node-1 eth0
  → node network
  → node-2 eth0
  → pod-b: 10.244.2.20
```

이것을 underlay routing에 가깝게 볼 수 있다.

## 07. overlay tunnel 방식

모든 환경에서 node network가 Pod CIDR을 직접 routing할 수 있는 것은 아니다.

예를 들어 물리 네트워크나 cloud network가 `10.244.0.0/16` 같은 Pod CIDR을 알지 못할 수 있다.

이때 CNI는 overlay tunnel을 사용할 수 있다.

대표적인 방식으로 VXLAN이 있다.

VXLAN을 쓰면 원래 Pod 패킷을 node 간 통신 가능한 IP 패킷 안에 한 번 더 감싼다.

```text
inner packet:
  src = 10.244.1.10
  dst = 10.244.2.20

outer packet:
  src = node-1 IP
  dst = node-2 IP
```

node network는 outer packet만 보면 된다. 즉 node-1에서 node-2로 가는 일반 IP 패킷으로 보인다.

node-2에 도착하면 tunnel endpoint가 outer header를 벗기고, 안쪽의 original Pod packet을 꺼내 `pod-b`로 전달한다.

흐름은 다음과 같다.

```text
pod-a
  → node-1
  → encapsulation
  → node network
  → node-2
  → decapsulation
  → pod-b
```

overlay 방식의 장점은 node network가 Pod CIDR을 몰라도 된다는 점이다.

대신 단점도 있다.

- encapsulation overhead가 있다.
- MTU를 고려해야 한다.
- tunnel endpoint 상태를 이해해야 troubleshooting이 가능하다.

## 08. MTU는 왜 문제가 될까?

overlay를 쓰면 packet 위에 outer header가 추가된다.

기존 packet이 이미 MTU에 가까운 크기라면, header가 추가되면서 MTU를 초과할 수 있다.

예를 들어 node network MTU가 1500이고, VXLAN header로 인해 추가 overhead가 생긴다고 해보자. 그러면 Pod network의 MTU는 보통 그보다 작게 잡아야 한다.

그렇지 않으면 다음과 같은 문제가 생길 수 있다.

- 작은 요청은 성공하는데 큰 응답은 실패한다.
- 특정 API 호출만 timeout이 난다.
- TLS handshake나 image pull이 불안정하다.
- 간헐적으로 connection reset이 발생한다.

MTU 문제는 증상이 애매하게 나타나는 경우가 많다.

확인할 때는 Pod 안에서 packet size를 조절해 ping을 보내거나, CNI 설정의 MTU 값을 확인한다.

```bash
kubectl exec -it app -- ping -M do -s 1400 <target-pod-ip>
```

단, ICMP가 차단된 환경도 있으므로 결과를 해석할 때 주의해야 한다.

## 09. Pod-to-Pod에서 NAT는 필요한가?

Pod-to-Pod 통신을 이해할 때 NAT가 항상 들어간다고 생각하면 혼란스러워진다.

Kubernetes의 기본 관점에서 Pod끼리는 서로의 Pod IP를 목적지로 통신할 수 있어야 한다.

즉 이상적인 Pod-to-Pod 흐름은 다음과 같다.

```text
src = pod-a IP
dst = pod-b IP
```

중간에서 source IP가 node IP로 바뀌지 않아도 통신할 수 있어야 한다.

물론 실제 CNI 구현이나 특정 환경에서는 SNAT, masquerade, egress gateway 같은 기능이 개입할 수 있다. 하지만 기본적인 Pod-to-Pod 모델을 이해할 때는 먼저 "Pod IP가 그대로 목적지까지 간다"는 관점으로 잡는 것이 좋다.

NAT가 주로 더 중요해지는 지점은 다음 편들에서 다룰 Service, NodePort, external traffic, egress traffic이다.

## 10. 문제를 추적하는 순서

Pod-to-Pod 통신이 안 될 때는 감으로 보기보다 경로를 나눠서 확인하는 것이 좋다.

먼저 Pod IP와 노드를 확인한다.

```bash
kubectl get pod -o wide
```

source와 destination이 같은 노드인지 다른 노드인지 확인한다.

```text
source pod node == destination pod node ?
```

source Pod 안에서 route를 확인한다.

```bash
kubectl exec -it source -- ip route
```

source node에서 destination Pod IP로 route lookup을 해본다.

```bash
ip route get <destination-pod-ip>
```

node 간 연결도 확인한다.

```bash
ping <destination-node-ip>
```

가능하다면 tcpdump로 어느 지점까지 packet이 보이는지 본다.

```bash
tcpdump -ni any host <destination-pod-ip>
```

이때 중요한 것은 "안 된다"가 아니라 "어디까지 갔는가"다.

- source Pod에서 나가지 못하는가?
- source node까지는 오는가?
- destination node까지는 가는가?
- destination Pod veth로 들어가는가?
- application port가 실제로 열려 있는가?

네트워크 문제는 경로를 잘라서 보면 훨씬 명확해진다.

## 11. 이번 편의 핵심 정리

이번 글에서는 Pod-to-Pod 통신을 같은 노드와 다른 노드로 나눠서 살펴봤다.

핵심은 다음과 같다.

- Pod의 `eth0`는 host 쪽 veth와 연결된다.
- 같은 노드 Pod 통신은 host namespace 안에서 bridge 또는 routing을 통해 전달된다.
- 다른 노드 Pod 통신은 node network를 통과한다.
- 노드별 Pod CIDR을 기반으로 routing할 수 있다.
- node network가 Pod CIDR을 직접 모르면 overlay tunnel을 사용할 수 있다.
- overlay 환경에서는 MTU를 반드시 고려해야 한다.
- 기본 Pod-to-Pod 관점에서는 source Pod IP와 destination Pod IP가 유지되는 흐름으로 이해하는 것이 좋다.

이제 Pod끼리 직접 통신하는 흐름을 봤다.

하지만 실제 애플리케이션은 보통 Pod IP를 직접 바라보지 않는다. Pod는 언제든 사라지고 다시 생성될 수 있기 때문이다. 다음 편에서는 변하는 Pod 집합 앞에 안정적인 진입점을 제공하는 Service와 EndpointSlice를 정리한다.
