---
title: "쿠버네티스 Deep Dive - 네트워크 편 5 | kube-proxy와 Virtual IP"
published: 2026-05-13
description: "Service의 ClusterIP가 실제 backend Pod로 연결되는 과정을 kube-proxy, virtual IP, DNAT, conntrack 관점에서 정리합니다."
image: "/assets/series/kubernetes-network-deep-dive.png"
tags: ["Kubernetes", "Network", "kube-proxy", "Service", "Virtual IP", "iptables", "IPVS", "nftables"]
category: "Kubernetes"
draft: true
lang: "ko"
cropCover: false
coverLayout: "wide"
series: "kubernetes-network-deep-dive"
seriesOrder: 5
---

이전 편에서 Service와 EndpointSlice를 정리했다.

아직 풀리지 않은 질문이 있다.

> ClusterIP는 어느 Pod에도 붙어 있지 않은데, 어떻게 실제 Pod로 연결될까?

예를 들어 다음 Service가 있다고 하자.

```text
Service backend
ClusterIP: 10.96.10.25
Port: 80

Endpoints:
- 10.244.1.11:8080
- 10.244.2.17:8080
- 10.244.3.25:8080
```

client Pod가 `10.96.10.25:80`으로 요청을 보낸다.

그런데 `10.96.10.25`라는 IP는 실제 Pod의 IP가 아니다. 어떤 노드의 물리 NIC에 붙어 있는 IP도 아니다.

이 IP는 Service를 위한 virtual IP다.

이번 편에서는 kube-proxy가 이 virtual IP를 어떻게 실제 endpoint로 연결하는지 살펴본다.

## 01. Service IP는 virtual IP다

ClusterIP를 처음 보면 일반적인 IP처럼 느껴진다.

```bash
kubectl get svc backend
```

```text
NAME      TYPE        CLUSTER-IP     PORT(S)
backend   ClusterIP   10.96.10.25    80/TCP
```

하지만 노드에서 다음처럼 확인해보면 보통 이 IP가 interface에 직접 붙어 있지 않다.

```bash
ip addr | grep 10.96.10.25
```

결과가 없을 수 있다.

그렇다면 이 IP로 보낸 packet은 어떻게 처리될까?

답은 노드의 dataplane rule이다.

Service IP로 향하는 packet이 노드의 network stack을 지나갈 때, kube-proxy가 미리 구성해둔 rule에 의해 destination이 실제 backend Pod IP로 바뀐다.

```text
10.96.10.25:80
  → 10.244.2.17:8080
```

이 변환은 일반적으로 DNAT로 이해할 수 있다.

DNAT는 Destination NAT다. packet의 목적지 주소나 port를 바꾸는 동작이다.

## 02. kube-proxy의 역할

kube-proxy라는 이름 때문에 실제 proxy process가 모든 traffic을 받아서 user space에서 중계한다고 오해하기 쉽다.

현대적인 Linux 환경에서 kube-proxy의 핵심 역할은 보통 다음에 가깝다.

> Service와 EndpointSlice를 watch하고, 노드의 packet forwarding rule을 구성한다.

kube-proxy는 API Server를 통해 Service와 EndpointSlice 변화를 본다.

```text
API Server
  → Service watch
  → EndpointSlice watch
  → kube-proxy on each node
  → node dataplane rules
```

새 Service가 생기면 kube-proxy는 해당 Service IP와 port로 들어오는 traffic을 backend endpoint 중 하나로 보내도록 rule을 만든다.

EndpointSlice가 바뀌면 rule도 갱신된다.

예를 들어 backend Pod가 하나 늘어나면 kube-proxy는 그 endpoint를 traffic 대상에 포함할 수 있게 dataplane을 갱신한다.

중요한 점은 kube-proxy가 각 노드에서 동작한다는 것이다.

Service traffic은 어떤 노드에서 시작될지 알 수 없다. client Pod가 어느 노드에 있든, 그 노드에서 Service IP를 backend Pod IP로 바꿀 수 있어야 한다.

그래서 kube-proxy는 모든 노드에 Service rule을 구성한다.

## 03. ClusterIP packet 흐름

같은 클러스터 안의 client Pod가 backend Service로 요청하는 흐름을 보자.

```text
client Pod: 10.244.1.50
backend Service: 10.96.10.25:80
backend Pod: 10.244.2.17:8080
```

application은 Service IP로 요청을 보낸다.

```bash
curl http://10.96.10.25
```

packet은 처음에 다음과 같다.

```text
src = 10.244.1.50
dst = 10.96.10.25:80
```

client Pod에서 나온 packet은 host network로 들어온다. 이때 node의 dataplane rule이 Service IP를 감지한다.

그리고 destination을 backend Pod로 바꾼다.

```text
src = 10.244.1.50
dst = 10.244.2.17:8080
```

이후 packet은 일반 Pod-to-Pod 통신처럼 destination Pod로 이동한다.

응답 packet은 반대로 돌아온다.

```text
src = 10.244.2.17:8080
dst = 10.244.1.50
```

그런데 client application 입장에서는 자신이 `10.96.10.25:80`과 통신했다고 생각해야 한다. 여기서 conntrack이 중요해진다.

conntrack은 connection 상태를 기억하고, NAT가 적용된 흐름의 응답 packet을 올바르게 되돌려준다.

## 04. conntrack이 필요한 이유

NAT는 단방향으로 destination만 바꾸고 끝나는 작업이 아니다.

client가 Service IP로 요청했다면 client는 응답도 Service IP에서 온 것처럼 받아야 한다.

요청 시점에 다음 변환이 있었다고 해보자.

```text
before DNAT:
src = 10.244.1.50
dst = 10.96.10.25:80

after DNAT:
src = 10.244.1.50
dst = 10.244.2.17:8080
```

backend Pod는 `10.244.1.50`에게 응답한다.

```text
src = 10.244.2.17:8080
dst = 10.244.1.50
```

이 응답을 그대로 client에게 전달하면 client 입장에서는 이상하다.

client는 `10.96.10.25:80`에 연결했다고 생각했는데, 갑자기 `10.244.2.17:8080`에서 응답이 온 것처럼 보이기 때문이다.

conntrack은 처음 NAT 변환을 기억하고 있다가 응답 packet을 적절히 복원한다.

그래서 client application은 Service IP와 통신한 것처럼 연결을 유지할 수 있다.

Service 문제를 분석할 때 conntrack이 자주 등장하는 이유가 여기에 있다.

## 05. iptables mode

kube-proxy의 대표적인 구현 방식 중 하나는 iptables mode다.

iptables mode에서 kube-proxy는 Linux netfilter/iptables rule을 구성한다.

Service마다 chain이 만들어지고, endpoint마다 backend로 보내는 rule이 만들어진다.

개념적으로는 다음과 비슷하다.

```text
KUBE-SERVICES
  → Service backend 10.96.10.25:80
    → backend endpoint 후보 중 하나 선택
      → DNAT to 10.244.2.17:8080
```

실제 rule 이름은 더 복잡하지만, 이해해야 하는 흐름은 이렇다.

```text
Service IP 감지
  → backend endpoint 선택
  → DNAT
  → Pod-to-Pod routing
```

iptables mode는 단순하고 오래 사용되어 왔다. 하지만 Service와 endpoint 수가 매우 많아지면 rule 수가 많아지고, 갱신 비용이 커질 수 있다.

그래서 규모가 큰 클러스터에서는 rule sync 시간이나 kube-proxy 지표를 함께 살펴봐야 한다.

## 06. IPVS mode

IPVS는 Linux kernel의 load balancing 기능이다.

kube-proxy가 IPVS mode로 동작하면 Service를 virtual server처럼 만들고, endpoint들을 real server처럼 등록한다.

개념적으로는 다음과 같다.

```text
Virtual Server:
  10.96.10.25:80

Real Servers:
  10.244.1.11:8080
  10.244.2.17:8080
  10.244.3.25:8080
```

IPVS는 load balancing algorithm을 사용할 수 있고, 많은 Service와 endpoint를 다룰 때 iptables와 다른 성능 특성을 가진다.

확인은 다음 명령으로 할 수 있다.

```bash
ipvsadm -Ln
```

다만 어떤 mode가 더 좋다고 단순히 말하기는 어렵다. cluster version, 운영 방식, CNI, kernel, traffic pattern에 따라 선택이 달라질 수 있다.

중요한 것은 IPVS mode도 결국 Service virtual IP를 backend endpoint로 연결하는 dataplane이라는 점이다.

## 07. nftables mode

최근 Linux 환경에서는 nftables 기반 dataplane도 중요해졌다.

nftables는 iptables를 대체하는 현대적인 packet filtering framework다. kube-proxy가 nftables mode로 동작하면 Service rule을 nftables 기반으로 구성한다.

운영자가 이해해야 하는 관점은 같다.

```text
kube-proxy
  → Service/EndpointSlice watch
  → nftables rules programming
  → Service IP traffic DNAT
```

다만 troubleshooting 명령은 iptables와 달라진다.

iptables mode라면 다음을 볼 수 있다.

```bash
iptables-save
```

nftables mode라면 다음을 볼 수 있다.

```bash
nft list ruleset
```

클러스터에서 어떤 kube-proxy mode를 쓰는지 먼저 확인해야 하는 이유다.

## 08. eBPF 기반 Service 처리

일부 CNI는 kube-proxy를 대체하거나 우회하는 방식으로 Service dataplane을 구현한다.

예를 들어 eBPF 기반 dataplane에서는 kernel hook에 붙은 eBPF program이 Service IP를 backend Pod로 변환할 수 있다.

이 경우 kube-proxy가 없거나, kube-proxy rule을 사용하지 않을 수 있다.

흐름은 여전히 비슷하다.

```text
Service IP
  → backend endpoint 선택
  → destination rewrite
  → Pod로 forwarding
```

달라지는 것은 구현 위치와 관찰 도구다.

iptables rule을 아무리 봐도 Service rule이 보이지 않을 수 있다. 이 경우에는 사용 중인 CNI의 전용 CLI나 observability 도구로 Service map, endpoint map, policy map 등을 확인해야 한다.

따라서 Service 문제를 볼 때 첫 질문은 이것이어야 한다.

> 이 클러스터의 Service dataplane은 무엇이 담당하는가?

## 09. NodePort 흐름

NodePort는 각 노드의 특정 port로 들어온 traffic을 Service backend로 보낸다.

```text
external client
  → node-ip:30080
  → backend Pod
```

packet이 node의 `30080` port로 들어오면 dataplane rule이 이를 Service traffic으로 인식한다.

그리고 endpoint 중 하나로 보낸다.

```text
node-ip:30080
  → 10.244.2.17:8080
```

여기서 주의할 점은 backend Pod가 반드시 그 노드에 있어야 하는 것은 아니라는 것이다.

기본적으로 node-1로 들어온 NodePort traffic이 node-2의 Pod로 전달될 수 있다.

```text
client
  → node-1:30080
  → node-2의 backend Pod
```

이 경우 추가 hop이 생길 수 있고, source IP 보존 여부도 설정에 따라 달라진다.

## 10. externalTrafficPolicy

외부 traffic에서 source IP 보존은 자주 중요한 문제가 된다.

Service에는 `externalTrafficPolicy`라는 설정이 있다.

```yaml
spec:
  externalTrafficPolicy: Cluster
```

`Cluster`는 기본적인 동작에 가깝다. node로 들어온 외부 traffic이 클러스터 전체 endpoint 중 하나로 전달될 수 있다.

장점은 traffic 분산이 쉽다는 것이다. 단점은 경우에 따라 source IP가 보존되지 않을 수 있다는 점이다.

반면 `Local`은 해당 node에 있는 local endpoint로만 traffic을 보낸다.

```yaml
spec:
  externalTrafficPolicy: Local
```

이 경우 source IP 보존에 유리하지만, traffic이 들어온 node에 local endpoint가 없으면 전달할 backend가 없을 수 있다.

따라서 LoadBalancer와 함께 사용할 때는 다음을 고려해야 한다.

- load balancer가 어떤 node로 traffic을 보내는가?
- 각 node에 local endpoint가 있는가?
- health check는 local endpoint 유무를 반영하는가?
- source IP 보존이 필요한가?

이 설정은 단순한 최적화 옵션이 아니라 traffic 경로를 바꾸는 중요한 네트워크 설정이다.

## 11. internalTrafficPolicy

내부 traffic에도 비슷한 관점이 있다.

`internalTrafficPolicy`를 사용하면 cluster 내부 client가 Service로 접근할 때 local endpoint를 우선하거나 제한하는 방식의 동작을 구성할 수 있다.

예를 들어 node-local traffic을 선호하면 cross-node hop을 줄일 수 있다.

하지만 local endpoint가 없는 경우에는 접근성이 달라질 수 있다.

따라서 이 설정은 성능 최적화와 가용성 사이의 균형으로 봐야 한다.

네트워크 최적화 옵션을 사용할 때는 항상 다음 질문을 함께 해야 한다.

- 이 설정은 어떤 packet path를 줄이는가?
- local endpoint가 없을 때 어떻게 되는가?
- rollout 중 endpoint 분포가 바뀌면 문제가 없는가?

## 12. sessionAffinity

Service는 기본적으로 요청을 여러 endpoint로 분산할 수 있다.

하지만 어떤 경우에는 같은 client가 같은 backend Pod로 가기를 원할 수 있다.

이때 `sessionAffinity: ClientIP`를 사용할 수 있다.

```yaml
spec:
  sessionAffinity: ClientIP
```

이 설정을 사용하면 client IP 기준으로 같은 endpoint가 선택되도록 sticky한 동작을 기대할 수 있다.

하지만 이것을 application session 관리의 완전한 대체로 생각하면 위험하다.

Pod는 사라질 수 있고, endpoint 목록은 바뀔 수 있으며, NAT나 proxy 계층 때문에 client IP가 기대와 다르게 보일 수 있다.

가능하면 application 자체는 특정 Pod에 강하게 의존하지 않는 구조로 만드는 것이 좋다.

## 13. Service 문제를 디버깅하는 순서

Service traffic이 안 될 때는 다음 순서로 나누어 본다.

먼저 Service와 EndpointSlice를 확인한다.

```bash
kubectl get svc backend
kubectl get endpointslice -l kubernetes.io/service-name=backend
```

endpoint가 없다면 kube-proxy를 볼 단계가 아니다. selector, label, readiness, targetPort를 먼저 봐야 한다.

endpoint가 있다면 kube-proxy 상태를 확인한다.

```bash
kubectl -n kube-system get pod -l k8s-app=kube-proxy -o wide
```

노드에서 mode에 맞는 rule을 본다.

```bash
iptables-save | grep KUBE-SVC
ipvsadm -Ln
nft list ruleset
```

conntrack을 확인해야 할 수도 있다.

```bash
conntrack -L | grep <service-ip>
```

마지막으로 실제 packet이 어느 지점까지 보이는지 tcpdump로 추적한다.

```bash
tcpdump -ni any host <service-ip>
tcpdump -ni any host <backend-pod-ip>
```

Service 문제는 다음 세 층으로 나누면 훨씬 명확해진다.

```text
Service object layer
  → EndpointSlice layer
  → node dataplane layer
```

## 14. 이번 편의 핵심 정리

이번 글에서는 kube-proxy와 Service virtual IP를 정리했다.

핵심은 다음과 같다.

- ClusterIP는 특정 interface에 붙은 실제 IP가 아니라 virtual IP다.
- kube-proxy는 Service와 EndpointSlice를 watch하고 node dataplane rule을 구성한다.
- Service IP로 향하는 packet은 backend Pod IP로 DNAT될 수 있다.
- conntrack은 NAT된 connection의 응답 흐름을 맞추는 데 중요하다.
- kube-proxy는 iptables, IPVS, nftables mode로 동작할 수 있다.
- 일부 CNI는 eBPF 기반으로 kube-proxy를 대체할 수 있다.
- NodePort와 LoadBalancer traffic은 source IP, local endpoint, health check를 함께 고려해야 한다.

이제 Service IP가 실제 Pod로 연결되는 흐름을 봤다.

다음 편에서는 사용자가 보통 IP를 직접 쓰지 않는다는 사실에서 출발한다. Service 이름은 어떻게 IP로 바뀌고, CoreDNS는 어떤 역할을 하며, headless Service는 왜 다른 결과를 반환하는지 정리해보자.
