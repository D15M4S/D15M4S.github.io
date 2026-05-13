---
title: "쿠버네티스 Deep Dive - 네트워크 편 2 | Network Model과 CNI"
published: 2026-05-13
description: "Kubernetes Network Model이 요구하는 Pod 중심 네트워크 관점과 CNI가 Pod network를 구성하는 흐름을 정리합니다."
image: "/assets/series/kubernetes-network-deep-dive.png"
tags: ["Kubernetes", "Network", "CNI", "Pod", "Container Runtime", "IPAM"]
category: "Kubernetes"
draft: true
lang: "ko"
cropCover: false
coverLayout: "wide"
series: "kubernetes-network-deep-dive"
seriesOrder: 2
---

1편에서는 Kubernetes 네트워크를 보기 전에 필요한 Linux 네트워크 요소를 정리했다.

이번 편에서는 그 기반 위에서 Kubernetes가 네트워크를 어떤 모델로 바라보는지, 그리고 CNI가 그 모델을 실제 노드 위에 어떻게 구성하는지 살펴본다.

Kubernetes 네트워크를 처음 볼 때 가장 헷갈리는 지점은 이것이다.

> container가 아니라 Pod가 네트워크의 기본 단위다.

container runtime은 container를 실행하지만, Kubernetes에서 애플리케이션이 바라보는 네트워크 단위는 Pod다. Pod는 하나의 IP를 갖고, 같은 Pod 안의 container들은 그 IP와 port 공간을 공유한다.

이 사실을 기준으로 잡으면 `Pod IP`, `pause container`, `eth0`, `CNI`, `IPAM`, `Pod CIDR` 같은 개념이 하나의 흐름으로 연결된다.

## 01. Kubernetes Network Model의 핵심

Kubernetes의 네트워크 모델은 복잡한 기능 목록이라기보다 몇 가지 전제를 중심으로 이해하는 편이 좋다.

핵심은 다음과 같다.

- Pod는 고유한 IP를 가진다.
- Pod 안의 container들은 같은 network namespace를 공유한다.
- Pod끼리는 서로의 Pod IP를 목적지로 통신할 수 있어야 한다.
- 노드도 Pod IP를 향해 통신할 수 있어야 한다.
- Service는 변하는 Pod 집합 앞에 안정적인 진입점을 제공한다.

여기서 중요한 것은 **Pod IP가 일급 네트워크 주소처럼 다뤄진다**는 점이다.

전통적인 container 네트워크를 떠올리면 container가 host 뒤에 숨어 있고, 외부에서는 port mapping을 통해 접근하는 그림을 먼저 생각할 수 있다.

하지만 Kubernetes는 기본적으로 그렇게 보지 않는다. 각 Pod가 자체 IP를 가지고, 다른 Pod는 그 IP를 직접 목적지로 사용할 수 있어야 한다.

이 관점은 애플리케이션 구조를 단순하게 만든다.

예를 들어 `frontend` Pod가 `backend` Pod와 통신한다고 해보자. `frontend` 입장에서는 `backend`가 어느 노드에 있는지, 어떤 host port에 매핑되어 있는지 알 필요가 없다. 결국 목적지는 `backend`의 Pod IP 또는 그 앞의 Service 이름이다.

즉 Kubernetes 네트워크 모델은 애플리케이션에게 다음과 같은 세계를 제공하려고 한다.

> Pod는 클러스터 안에서 독립적인 네트워크 주체처럼 보인다.

## 02. Pod IP는 container IP가 아니다

Kubernetes에서 Pod IP를 container IP라고 부르면 정확하지 않다.

Pod 안에는 여러 container가 들어갈 수 있다. 그런데 Pod IP는 container마다 하나씩 주어지는 것이 아니라, Pod 단위로 하나가 주어진다.

그 이유는 같은 Pod 안의 container들이 하나의 network namespace를 공유하기 때문이다.

```text
Pod
├── network namespace
│   ├── eth0: 10.244.1.23
│   ├── lo
│   └── routing table
├── app container
└── sidecar container
```

`app container`와 `sidecar container`는 서로 다른 process 공간을 가질 수 있지만, 네트워크 관점에서는 같은 namespace 안에 있다.

그래서 다음과 같은 특징이 생긴다.

- 두 container는 같은 IP를 본다.
- 두 container는 같은 loopback interface를 본다.
- 한 container가 `127.0.0.1:8080`에 바인딩하면, 같은 Pod 안의 다른 container가 `localhost:8080`으로 접근할 수 있다.
- 같은 Pod 안에서 같은 port를 두 container가 동시에 사용할 수 없다.

이 구조를 이해하면 sidecar pattern도 자연스럽다.

예를 들어 application container가 `localhost:15001`로 요청을 보내고, sidecar proxy가 같은 Pod 안에서 그 요청을 받아 처리할 수 있다. 둘은 같은 Pod IP를 공유하지만 process는 분리되어 있다.

## 03. pause container는 왜 등장할까?

Pod에는 흔히 `pause container` 또는 sandbox container라고 부르는 작은 container가 함께 등장한다.

이 container의 목적은 애플리케이션 로직을 실행하는 것이 아니다. 핵심 역할은 **Pod의 네트워크 namespace를 잡고 유지하는 것**이다.

흐름을 단순화하면 다음과 같다.

1. kubelet이 container runtime에게 Pod sandbox 생성을 요청한다.
2. container runtime은 Pod를 위한 sandbox를 만든다.
3. sandbox에 network namespace가 만들어진다.
4. CNI plugin이 그 network namespace에 interface와 IP를 설정한다.
5. application container들이 해당 namespace에 합류한다.

즉 Pod의 network namespace는 특정 application container 하나에 종속되지 않는다.

application container가 재시작되어도 Pod 자체가 유지되는 동안에는 같은 Pod network namespace를 계속 사용할 수 있다. 이 덕분에 Pod 안의 container 재시작과 Pod 네트워크 생명주기를 어느 정도 분리해서 다룰 수 있다.

정리하면 pause container는 다음 질문에 대한 답이다.

> Pod의 네트워크 공간은 누가 소유하고 유지하는가?

## 04. CNI는 무엇을 하는가?

CNI는 Container Network Interface의 약자다.

이름만 보면 거창하지만, 핵심은 단순하다.

> container runtime이 네트워크 plugin을 호출하는 표준 인터페이스다.

Kubernetes 자체가 모든 네트워크 구현을 직접 갖고 있지는 않다. Pod IP를 어떻게 할당할지, 노드 간 Pod 트래픽을 어떤 방식으로 보낼지, overlay를 쓸지, cloud VPC routing을 쓸지, eBPF dataplane을 쓸지 같은 선택은 CNI plugin 구현에 따라 달라진다.

Kubernetes가 기대하는 것은 결과다.

- Pod에 IP가 있어야 한다.
- Pod namespace 안에 interface가 있어야 한다.
- Pod IP로 통신할 수 있어야 한다.
- Pod가 삭제되면 네트워크 자원이 정리되어야 한다.

CNI plugin은 이 결과를 만들기 위해 Linux 네트워크 기능을 조합한다.

대표적으로 다음 작업들이 포함될 수 있다.

- Pod network namespace 안에 `eth0` 생성
- host 쪽 veth 생성
- IP 주소 할당
- route 설정
- bridge 연결
- overlay tunnel 설정
- policy enforcement를 위한 rule 설정
- Pod 삭제 시 interface, IP, rule 정리

이 작업 중 무엇을 어떻게 하는지는 plugin마다 다르다.

## 05. Pod 생성 시 네트워크가 붙는 흐름

Pod가 생성될 때 네트워크는 대략 다음 순서로 붙는다.

```text
API Server
  ↓
Scheduler
  ↓
kubelet on selected node
  ↓
container runtime
  ↓
Pod sandbox 생성
  ↓
CNI ADD 호출
  ↓
Pod eth0, IP, route 구성
  ↓
application container 시작
```

조금 더 풀어서 보자.

먼저 사용자가 Pod 또는 Deployment를 생성하면 API Server에 desired state가 저장된다. Scheduler는 이 Pod를 실행할 노드를 선택한다.

선택된 노드의 kubelet은 자신에게 할당된 Pod를 확인하고 container runtime에게 Pod sandbox 생성을 요청한다. runtime은 sandbox를 만들고, 이 sandbox의 network namespace를 준비한다.

이후 runtime은 CNI plugin을 호출한다. 보통 이때 CNI `ADD` 동작이 실행된다.

CNI plugin은 전달받은 network namespace 경로를 기준으로 다음과 같은 작업을 수행한다.

```text
host namespace
  └── veth-host
        ↕
pod network namespace
  └── eth0: Pod IP
```

그리고 IPAM을 통해 Pod IP를 할당한다.

IPAM은 IP Address Management를 의미한다. 단순히 말하면 "이 Pod에게 어떤 IP를 줄 것인가"를 결정하는 부분이다.

IPAM도 plugin마다 다르다.

- 노드별 Pod CIDR에서 IP를 나눠줄 수 있다.
- 클러스터 전체 IP pool에서 IP를 할당할 수 있다.
- cloud provider의 VPC IP를 Pod에 직접 붙일 수 있다.
- 별도 IPAM 시스템과 연동할 수도 있다.

Pod가 삭제될 때는 반대로 CNI `DEL` 동작이 실행되어 관련 자원이 정리된다.

## 06. CNI 설정 파일과 plugin binary

노드 안에서 CNI는 보통 두 종류의 파일로 구성된다.

```text
/etc/cni/net.d/
/opt/cni/bin/
```

`/etc/cni/net.d/`에는 CNI 설정 파일이 들어간다. 이 파일은 어떤 plugin을 어떤 순서로 호출할지, IPAM은 무엇을 쓸지, 추가 capability는 무엇을 켤지 등을 정의한다.

`/opt/cni/bin/`에는 실제 실행되는 CNI plugin binary가 들어간다.

예를 들어 설정 파일이 `type: bridge`를 가리키면 runtime은 CNI binary directory에서 `bridge` plugin을 찾아 실행한다.

실제 클러스터에서는 Calico, Cilium, Flannel, Antrea, AWS VPC CNI 같은 plugin이 이 자리를 차지할 수 있다.

중요한 것은 Kubernetes가 특정 plugin 구현을 강제하지 않는다는 점이다. Kubernetes는 Network Model을 만족하는 결과를 기대하고, CNI plugin은 각자의 방식으로 그 결과를 만든다.

## 07. Pod 안에서 보이는 네트워크

Pod 안에 들어가서 네트워크를 확인하면 보통 다음과 같은 그림을 보게 된다.

```bash
kubectl exec -it app -- ip addr
```

예시는 다음과 비슷하다.

```text
1: lo: <LOOPBACK,UP,LOWER_UP>
    inet 127.0.0.1/8 scope host lo

3: eth0@if21: <BROADCAST,MULTICAST,UP,LOWER_UP>
    inet 10.244.1.23/24 scope global eth0
```

여기서 `eth0@if21` 같은 표기는 Pod 안의 `eth0`가 host 쪽 어떤 interface와 veth pair로 연결되어 있음을 암시한다.

route도 확인할 수 있다.

```bash
kubectl exec -it app -- ip route
```

예시는 다음과 비슷할 수 있다.

```text
default via 10.244.1.1 dev eth0
10.244.1.0/24 dev eth0 proto kernel scope link src 10.244.1.23
```

이 route는 "Pod 밖으로 나가는 패킷을 어디로 보낼 것인가"를 결정한다.

Pod 입장에서 default gateway가 보이고, host 쪽에서는 이 패킷을 받아 다음 경로로 전달한다. 이 다음 경로가 bridge일 수도 있고, routing table일 수도 있고, overlay tunnel일 수도 있다.

## 08. CNI마다 달라지는 부분

CNI plugin은 같은 Kubernetes 모델을 구현하지만 내부 방식은 크게 다를 수 있다.

예를 들어 같은 노드의 Pod끼리 통신할 때 어떤 plugin은 Linux bridge를 중심으로 구성하고, 어떤 plugin은 veth와 routing을 중심으로 구성할 수 있다.

다른 노드의 Pod끼리 통신할 때도 방식이 갈린다.

- 각 노드의 Pod CIDR로 직접 routing한다.
- VXLAN 같은 overlay tunnel을 사용한다.
- cloud route table을 조작한다.
- Pod에 VPC IP를 직접 할당한다.
- eBPF program으로 forwarding과 policy를 처리한다.

따라서 특정 CNI의 동작을 볼 때는 다음 질문을 던져야 한다.

- Pod IP는 어디에서 할당되는가?
- 노드별 Pod CIDR이 있는가?
- 같은 노드 Pod 간 통신은 bridge인가, routing인가?
- 다른 노드 Pod 간 통신은 underlay인가, overlay인가?
- Service 처리는 kube-proxy가 하는가, CNI가 대체하는가?
- NetworkPolicy는 어떤 계층에서 적용되는가?

Kubernetes 네트워크를 깊게 이해한다는 것은 결국 이 질문들에 답할 수 있게 되는 것이다.

## 09. 직접 확인할 때의 관찰 포인트

실제 클러스터에서 CNI 흐름을 확인할 때는 다음 순서로 보는 것이 좋다.

먼저 Pod IP와 배치된 노드를 확인한다.

```bash
kubectl get pod -o wide
```

그다음 해당 노드에서 interface를 확인한다.

```bash
ip link
ip addr
```

route table을 확인한다.

```bash
ip route
```

Pod 내부에서도 같은 정보를 본다.

```bash
kubectl exec -it app -- ip addr
kubectl exec -it app -- ip route
```

CNI 설정도 확인한다.

```bash
ls -al /etc/cni/net.d/
ls -al /opt/cni/bin/
```

container runtime을 직접 다룰 수 있는 환경이라면 Pod sandbox 정보도 볼 수 있다.

```bash
crictl pods
crictl inspectp <pod-sandbox-id>
```

이때 관찰해야 하는 것은 단순히 출력값 자체가 아니라 연결 관계다.

```text
Pod IP
  → Pod eth0
  → host veth
  → bridge or route
  → node network
  → destination
```

이 관계를 그릴 수 있으면 CNI를 훨씬 덜 막연하게 이해할 수 있다.

## 10. 이번 편의 핵심 정리

이번 글에서는 Kubernetes Network Model과 CNI의 역할을 정리했다.

핵심은 다음과 같다.

- Kubernetes 네트워크의 기본 단위는 container가 아니라 Pod다.
- Pod는 하나의 network namespace를 갖고, 같은 Pod 안의 container들은 이를 공유한다.
- Pod IP는 Pod 단위로 부여된다.
- pause container는 Pod의 network namespace를 유지하는 역할을 한다.
- CNI는 runtime이 network plugin을 호출하는 표준 인터페이스다.
- CNI plugin은 Pod interface, IP, route, overlay, policy 등을 구성한다.
- Kubernetes는 특정 CNI 구현보다 Network Model의 결과를 기대한다.

이제 Pod가 IP를 갖는 과정은 어느 정도 잡혔다.

다음 편에서는 실제 패킷이 Pod에서 Pod로 이동할 때 어떤 경로를 거치는지 살펴본다. 같은 노드 안에서의 흐름과 다른 노드로 넘어가는 흐름을 나누어 보면 Kubernetes 네트워크가 훨씬 구체적으로 보이기 시작한다.
