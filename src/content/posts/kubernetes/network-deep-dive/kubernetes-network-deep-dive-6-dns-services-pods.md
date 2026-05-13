---
title: "쿠버네티스 Deep Dive - 네트워크 편 6 | DNS for Services and Pods"
published: 2026-05-13
description: "Kubernetes에서 Service와 Pod가 DNS 이름으로 발견되는 방식, CoreDNS의 역할, headless Service와 StatefulSet DNS 흐름을 정리합니다."
image: "/assets/series/kubernetes-network-deep-dive.png"
tags: ["Kubernetes", "Network", "DNS", "CoreDNS", "Service", "Headless", "StatefulSet"]
category: "Kubernetes"
draft: true
lang: "ko"
cropCover: false
coverLayout: "wide"
series: "kubernetes-network-deep-dive"
seriesOrder: 6
---

Service에는 ClusterIP가 있다.

하지만 실제 애플리케이션 코드는 보통 ClusterIP를 직접 쓰지 않는다.

```text
http://10.96.10.25
```

이렇게 IP를 박아두면 Service를 다시 만들거나 namespace가 바뀌거나 환경이 달라질 때 관리가 어려워진다.

그래서 애플리케이션은 보통 이름으로 접근한다.

```text
http://backend
http://backend.default
http://backend.default.svc.cluster.local
```

이번 편에서는 Kubernetes에서 이 이름이 어떻게 Service IP 또는 Pod IP로 해석되는지 살펴본다.

핵심은 DNS다.

## 01. DNS는 Service discovery의 입구다

Kubernetes 안에서 workload는 DNS를 통해 Service를 발견할 수 있다.

예를 들어 `frontend` Pod가 `backend` Service를 호출한다고 해보자.

```bash
curl http://backend
```

이때 application은 먼저 `backend`라는 이름을 IP로 해석해야 한다.

흐름은 대략 다음과 같다.

```text
application
  → resolver
  → Pod의 /etc/resolv.conf
  → cluster DNS Service
  → CoreDNS Pod
  → Service record lookup
  → ClusterIP 반환
```

이후 application은 반환받은 IP로 TCP connection을 만든다.

```text
backend.default.svc.cluster.local
  → 10.96.10.25
  → kube-proxy or dataplane
  → backend Pod
```

즉 DNS는 packet을 직접 backend Pod로 보내는 장치가 아니다. DNS는 먼저 이름을 IP로 바꿔준다. 그다음의 packet forwarding은 Service dataplane이 처리한다.

이 둘을 구분해야 한다.

```text
DNS: 이름 → IP
Service dataplane: Service IP → Pod IP
```

## 02. CoreDNS의 역할

Kubernetes 클러스터에는 보통 CoreDNS가 cluster DNS 역할을 한다.

CoreDNS는 Service와 Pod 정보를 바탕으로 DNS 응답을 만든다.

클러스터 안에는 DNS Service가 있고, Pod들은 이 DNS Service를 nameserver로 사용한다.

Pod 안에서 확인해보면 다음과 비슷하다.

```bash
kubectl exec -it app -- cat /etc/resolv.conf
```

```text
nameserver 10.96.0.10
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

여기서 `nameserver 10.96.0.10`은 보통 cluster DNS Service의 ClusterIP다.

application이 이름을 조회하면 resolver는 이 nameserver로 DNS query를 보낸다.

이 DNS query 자체도 Service traffic이다.

```text
app Pod
  → kube-dns/CoreDNS Service IP:53
  → CoreDNS Pod:53
```

따라서 DNS 문제가 생겼을 때도 Service, EndpointSlice, kube-proxy, NetworkPolicy 문제가 함께 얽힐 수 있다.

## 03. Service DNS 이름

Kubernetes Service의 전체 DNS 이름은 보통 다음 형식을 가진다.

```text
<service-name>.<namespace>.svc.<cluster-domain>
```

기본 cluster domain이 `cluster.local`이라면 다음과 같다.

```text
backend.default.svc.cluster.local
```

같은 namespace 안에서는 짧은 이름도 사용할 수 있다.

```text
backend
```

다른 namespace의 Service를 호출하려면 namespace를 포함하는 것이 안전하다.

```text
backend.api
backend.api.svc.cluster.local
```

예를 들어 `frontend` Pod가 `web` namespace에 있고, `backend` Service가 `api` namespace에 있다면 `backend`만으로는 원하는 Service를 찾지 못할 수 있다.

이때는 다음처럼 호출해야 한다.

```text
backend.api
```

namespace를 명시하는 습관은 DNS troubleshooting 시간을 크게 줄여준다.

## 04. search domain과 ndots

Pod의 `/etc/resolv.conf`에는 search domain 목록이 있다.

```text
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

application이 `backend`를 조회하면 resolver는 search domain을 붙여 여러 후보를 시도할 수 있다.

예를 들어 다음 순서로 질의할 수 있다.

```text
backend.default.svc.cluster.local
backend.svc.cluster.local
backend.cluster.local
backend
```

`ndots`는 이름에 dot이 몇 개 이상 있을 때 absolute name처럼 먼저 시도할지를 결정하는 옵션이다.

Kubernetes 환경에서는 `ndots:5`가 흔하다. 이 설정은 내부 Service 이름을 편하게 찾는 데 도움이 되지만, 외부 도메인을 자주 조회하는 workload에서는 불필요한 DNS query가 늘어날 수 있다.

예를 들어 application이 `api.example.com`을 조회할 때 search domain 조합이 먼저 시도되면 다음과 같은 query가 추가될 수 있다.

```text
api.example.com.default.svc.cluster.local
api.example.com.svc.cluster.local
api.example.com.cluster.local
api.example.com
```

이런 패턴은 latency나 DNS 부하로 이어질 수 있다.

외부 도메인을 자주 호출하는 workload에서는 trailing dot을 사용하거나 DNS 설정을 조정하는 전략을 검토할 수 있다.

```text
api.example.com.
```

## 05. 일반 Service의 DNS 응답

일반 ClusterIP Service는 DNS 조회 시 Service의 ClusterIP를 반환한다.

예를 들어 `backend` Service가 다음과 같다고 하자.

```text
backend.default.svc.cluster.local
ClusterIP: 10.96.10.25
```

Pod 안에서 조회하면 다음과 같은 결과를 기대할 수 있다.

```bash
kubectl exec -it app -- nslookup backend
```

```text
Name: backend.default.svc.cluster.local
Address: 10.96.10.25
```

이후 application은 `10.96.10.25`로 연결한다.

그 다음은 Service dataplane의 영역이다.

```text
backend DNS name
  → ClusterIP
  → kube-proxy/eBPF dataplane
  → backend Pod
```

따라서 일반 Service에서 DNS는 backend Pod IP를 직접 반환하지 않는다. DNS는 Service IP를 반환하고, Service IP 뒤에서 load balancing이 일어난다.

## 06. Headless Service의 DNS 응답

Headless Service는 다르다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  clusterIP: None
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080
```

Headless Service에는 ClusterIP가 없다.

따라서 DNS는 Service IP 하나를 반환하기보다 backend Pod IP 목록을 반환할 수 있다.

```text
backend.default.svc.cluster.local
  → 10.244.1.11
  → 10.244.2.17
  → 10.244.3.25
```

이 구조에서는 client가 DNS 응답으로 받은 Pod IP들 중 하나를 선택하거나, application/library가 자체적으로 분산을 처리할 수 있다.

Headless Service는 StatefulSet과 함께 자주 등장한다.

StatefulSet에서는 각 Pod가 안정적인 이름을 갖는다.

```text
mysql-0
mysql-1
mysql-2
```

Headless Service와 결합하면 각 Pod를 다음과 같은 이름으로 접근할 수 있다.

```text
mysql-0.mysql.default.svc.cluster.local
mysql-1.mysql.default.svc.cluster.local
mysql-2.mysql.default.svc.cluster.local
```

이것은 database cluster, message broker, consensus system처럼 각 replica의 정체성이 중요한 workload에서 유용하다.

## 07. SRV record와 named port

Service port에 이름을 붙이면 SRV record도 활용할 수 있다.

예를 들어 Service가 다음 port를 가진다고 하자.

```yaml
ports:
  - name: http
    port: 80
    targetPort: 8080
```

SRV record는 port 이름과 protocol을 포함하는 형태로 조회할 수 있다.

```text
_http._tcp.backend.default.svc.cluster.local
```

SRV record는 단순히 IP만이 아니라 service port 정보를 함께 제공할 수 있다.

모든 application이 SRV record를 사용하는 것은 아니지만, Kubernetes DNS를 이해할 때 named port가 DNS와도 연결될 수 있다는 점은 알아둘 만하다.

## 08. Pod DNS 이름

Kubernetes는 Pod에 대해서도 DNS record를 만들 수 있다.

다만 일반적으로 애플리케이션 간 통신에서는 Pod 이름보다 Service 이름을 사용하는 것이 권장된다.

Pod는 사라지고 다시 생길 수 있기 때문이다.

Pod DNS는 다음 상황에서 더 의미가 있다.

- StatefulSet에서 각 Pod의 stable identity가 필요하다.
- headless Service와 hostname/subdomain을 함께 사용한다.
- 특정 Pod를 직접 식별해야 하는 시스템을 구성한다.

Pod spec에는 `hostname`과 `subdomain`을 설정할 수 있다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: busybox-1
spec:
  hostname: busybox-1
  subdomain: busybox-subdomain
```

같은 namespace에 `busybox-subdomain`이라는 headless Service가 있으면 Pod의 FQDN을 구성할 수 있다.

```text
busybox-1.busybox-subdomain.default.svc.cluster.local
```

StatefulSet이 stable DNS를 제공할 수 있는 이유도 이 흐름과 연결된다.

## 09. DNS와 NetworkPolicy

NetworkPolicy를 사용하는 클러스터에서는 DNS traffic도 정책의 영향을 받을 수 있다.

예를 들어 namespace에 default deny egress를 적용하면 Pod가 CoreDNS로 DNS query를 보내지 못할 수 있다.

증상은 다음과 같다.

```text
curl http://backend
  → Could not resolve host
```

이때 backend Service 자체는 정상일 수 있다. 문제는 이름 해석이 막힌 것이다.

DNS egress를 허용하려면 CoreDNS로 가는 UDP/TCP 53 traffic을 열어야 한다.

환경마다 CoreDNS의 namespace와 label이 다를 수 있으므로 실제 cluster label을 확인해야 한다.

```bash
kubectl -n kube-system get pod --show-labels
kubectl -n kube-system get svc
```

DNS 문제는 Service 문제처럼 보이기도 하고, NetworkPolicy 문제처럼 보이기도 한다. 그래서 항상 먼저 name resolution과 IP connectivity를 분리해서 확인하는 것이 좋다.

## 10. NodeLocal DNSCache

규모가 큰 클러스터에서는 DNS query가 CoreDNS에 집중될 수 있다.

NodeLocal DNSCache는 각 노드에 DNS cache를 두어 Pod의 DNS query를 node-local endpoint에서 처리하게 하는 방식이다.

개념적으로는 다음과 같다.

```text
Pod
  → node-local DNS cache
  → CoreDNS
  → upstream DNS
```

장점은 다음과 같다.

- CoreDNS로 향하는 중복 query 감소
- node-local cache를 통한 latency 개선
- conntrack 부담 완화에 도움

물론 NodeLocal DNSCache를 사용하면 DNS 흐름을 볼 때 node-local component도 함께 봐야 한다.

DNS troubleshooting 시 `nameserver`가 CoreDNS Service IP가 아니라 node-local IP로 잡혀 있다면 이 구성을 의심해야 한다.

## 11. DNS를 디버깅하는 순서

DNS 문제는 다음 순서로 나누어 보면 좋다.

먼저 Pod의 resolver 설정을 본다.

```bash
kubectl exec -it app -- cat /etc/resolv.conf
```

Service 이름을 조회한다.

```bash
kubectl exec -it app -- nslookup backend
kubectl exec -it app -- nslookup backend.default.svc.cluster.local
```

ClusterIP로 직접 접근해본다.

```bash
kubectl exec -it app -- curl http://10.96.10.25
```

이렇게 하면 DNS 문제와 Service dataplane 문제를 분리할 수 있다.

CoreDNS Pod 상태를 확인한다.

```bash
kubectl -n kube-system get pod -l k8s-app=kube-dns
kubectl -n kube-system logs deploy/coredns
```

CoreDNS Service와 EndpointSlice도 본다.

```bash
kubectl -n kube-system get svc
kubectl -n kube-system get endpointslice
```

NetworkPolicy가 있다면 DNS egress가 허용되어 있는지 확인한다.

```bash
kubectl get networkpolicy -A
```

정리하면 다음 순서다.

```text
이름 조회 실패인가?
  → resolv.conf
  → CoreDNS Service
  → CoreDNS Pod
  → NetworkPolicy
  → upstream DNS

이름 조회는 되는데 연결 실패인가?
  → Service
  → EndpointSlice
  → kube-proxy/CNI
  → application port
```

## 12. 이번 편의 핵심 정리

이번 글에서는 Kubernetes DNS를 정리했다.

핵심은 다음과 같다.

- DNS는 이름을 IP로 바꾸는 Service discovery의 입구다.
- 일반 ClusterIP Service는 DNS 조회 시 ClusterIP를 반환한다.
- Headless Service는 backend Pod IP 목록을 반환할 수 있다.
- Service FQDN은 `<service>.<namespace>.svc.<cluster-domain>` 형태다.
- Pod의 `/etc/resolv.conf`에는 nameserver, search domain, ndots 설정이 들어간다.
- CoreDNS로 가는 DNS query 자체도 Service traffic이다.
- NetworkPolicy가 DNS traffic을 막으면 Service가 정상이어도 이름 해석이 실패한다.
- DNS 문제와 Service dataplane 문제는 반드시 분리해서 봐야 한다.

이제 클러스터 내부에서 이름으로 Service를 찾고, Service IP가 Pod로 연결되는 흐름까지 봤다.

다음 편에서는 클러스터 밖에서 들어오는 traffic을 다룬다. LoadBalancer, Ingress, Gateway API가 어떤 층에서 어떤 역할을 하는지 정리해보자.
