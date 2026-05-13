---
title: "쿠버네티스 Deep Dive - 네트워크 편 8 | NetworkPolicy와 네트워크 디버깅"
published: 2026-05-13
description: "NetworkPolicy의 ingress/egress 제어 모델과 Kubernetes 네트워크 장애를 계층별로 좁혀가는 디버깅 방법을 정리합니다."
image: "/assets/series/kubernetes-network-deep-dive.png"
tags: ["Kubernetes", "Network", "NetworkPolicy", "Debugging", "CNI", "DNS", "Service"]
category: "Kubernetes"
draft: true
lang: "ko"
cropCover: false
coverLayout: "wide"
series: "kubernetes-network-deep-dive"
seriesOrder: 8
---

지금까지 Kubernetes 네트워크의 주요 흐름을 살펴봤다.

- Pod가 IP를 갖는 방식
- CNI가 Pod network를 구성하는 방식
- Pod-to-Pod 통신
- Service와 EndpointSlice
- kube-proxy와 virtual IP
- DNS
- Ingress와 Gateway API

마지막으로 봐야 할 것은 "통신을 허용하거나 제한하는 방법"과 "문제가 생겼을 때 어디서부터 볼 것인가"다.

Kubernetes에서 Pod 간 traffic을 제어하는 대표적인 리소스가 NetworkPolicy다.

하지만 NetworkPolicy는 처음 접하면 오해하기 쉽다.

- policy를 만들면 모든 traffic이 막히는가?
- deny rule을 쓸 수 있는가?
- Service 이름 기준으로 허용할 수 있는가?
- DNS traffic도 열어야 하는가?
- CNI가 다르면 동작도 달라지는가?

이번 글에서는 NetworkPolicy의 모델을 정리하고, Kubernetes 네트워크 문제를 계층별로 디버깅하는 방법을 함께 정리한다.

## 01. NetworkPolicy의 기본 관점

NetworkPolicy는 Pod를 중심으로 traffic을 제어한다.

정확히는 특정 Pod 집합을 선택하고, 그 Pod에 대해 ingress 또는 egress traffic을 어떤 조건으로 허용할지 정의한다.

```text
NetworkPolicy
  → podSelector로 대상 Pod 선택
  → ingress rule
  → egress rule
```

중요한 점은 NetworkPolicy가 L3/L4 수준의 제어라는 것이다.

즉 IP, port, protocol 중심이다.

HTTP path나 header 같은 L7 조건을 NetworkPolicy 기본 모델로 직접 표현하지는 않는다.

예를 들어 다음과 같은 것은 NetworkPolicy의 관심사다.

```text
frontend Pod가 backend Pod의 TCP 8080으로 접근 가능
```

하지만 다음과 같은 것은 기본 NetworkPolicy의 관심사가 아니다.

```text
frontend Pod가 /admin path에는 접근 불가
```

이런 L7 제어는 service mesh, gateway, ingress controller, application authorization 계층에서 다루는 것이 일반적이다.

## 02. 기본은 allow다

NetworkPolicy를 이해할 때 가장 먼저 기억해야 할 점은 이것이다.

> 아무 NetworkPolicy도 없으면 기본적으로 Pod traffic은 허용된다.

NetworkPolicy는 traffic을 막는 기본 방화벽이라기보다, 특정 Pod를 선택해 격리 상태로 만들고 허용 규칙을 추가하는 모델에 가깝다.

예를 들어 namespace에 어떤 policy도 없다면 Pod들은 CNI가 제공하는 기본 연결성 안에서 서로 통신할 수 있다.

하지만 어떤 Pod가 NetworkPolicy의 `podSelector`에 의해 선택되면, 해당 방향의 traffic은 policy rule에 따라 제한된다.

예를 들어 ingress policy가 특정 Pod를 선택하면, 그 Pod로 들어오는 traffic은 명시적으로 허용된 것만 가능해진다.

## 03. podSelector는 policy의 적용 대상을 고른다

다음 NetworkPolicy를 보자.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-ingress
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

이 policy의 적용 대상은 `app=backend` Pod다.

```text
podSelector:
  app=backend
```

그리고 ingress rule은 `app=frontend` Pod에서 오는 TCP 8080 traffic을 허용한다.

```text
frontend Pod
  → backend Pod:8080 허용
```

여기서 자주 하는 실수가 있다.

`from.podSelector`가 선택하는 Pod는 "접근을 허용할 source"다. 반면 `spec.podSelector`는 "policy가 적용될 target"이다.

둘을 헷갈리면 완전히 반대 의미의 policy를 만들 수 있다.

## 04. namespaceSelector와 podSelector

다른 namespace의 Pod를 허용하려면 namespaceSelector를 함께 사용한다.

예를 들어 `team=frontend` label이 붙은 namespace의 `app=frontend` Pod만 backend에 접근하게 하려면 다음과 같이 쓸 수 있다.

```yaml
ingress:
  - from:
      - namespaceSelector:
          matchLabels:
            team: frontend
        podSelector:
          matchLabels:
            app: frontend
    ports:
      - protocol: TCP
        port: 8080
```

주의할 점은 YAML 구조다.

다음은 namespace와 pod 조건이 같은 item 안에 있으므로 AND에 가깝다.

```yaml
from:
  - namespaceSelector:
      matchLabels:
        team: frontend
    podSelector:
      matchLabels:
        app: frontend
```

반면 다음처럼 별도 item으로 나누면 OR처럼 해석될 수 있다.

```yaml
from:
  - namespaceSelector:
      matchLabels:
        team: frontend
  - podSelector:
      matchLabels:
        app: frontend
```

NetworkPolicy에서 indentation과 list 구조는 의미를 크게 바꾼다. policy가 기대와 다르게 동작할 때는 YAML 구조를 먼저 의심해야 한다.

## 05. ipBlock

`ipBlock`은 특정 CIDR을 허용할 때 사용한다.

```yaml
egress:
  - to:
      - ipBlock:
          cidr: 10.0.0.0/8
          except:
            - 10.96.0.0/12
```

이렇게 하면 특정 IP 대역으로 나가는 traffic을 허용하면서 일부 대역을 제외할 수 있다.

다만 ipBlock은 Service 이름이나 Pod label이 아니라 IP CIDR 기준이다.

클러스터 내부 Service IP, Pod IP, node IP, external IP 대역이 어떻게 나뉘어 있는지 모르면 ipBlock rule은 쉽게 위험해진다.

특히 cloud 환경에서는 외부 dependency IP가 바뀔 수 있고, NAT gateway나 proxy를 경유하면 실제 목적지 IP가 application이 생각한 것과 다를 수 있다.

ipBlock은 강력하지만 운영 부담도 있는 도구다.

## 06. egress policy와 DNS

egress를 제한하기 시작하면 DNS를 반드시 고려해야 한다.

다음은 namespace의 모든 Pod에 대해 egress를 기본 차단하는 policy다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
spec:
  podSelector: {}
  policyTypes:
    - Egress
```

이 policy가 적용되면 Pod는 외부 API뿐 아니라 CoreDNS로도 DNS query를 보내지 못할 수 있다.

증상은 다음과 같다.

```text
curl http://backend
  → Could not resolve host
```

이 경우 backend Service가 죽은 것이 아니다. 이름 해석이 막혔을 수 있다.

DNS를 허용하는 egress rule은 환경에 맞게 작성해야 한다.

예시는 다음과 같다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

실제 환경에서는 CoreDNS Pod label까지 함께 제한하는 것이 더 안전할 수 있다.

다만 label은 cluster마다 다를 수 있으므로 먼저 확인해야 한다.

```bash
kubectl -n kube-system get pod --show-labels
```

## 07. default deny ingress

namespace 안의 모든 Pod에 대해 ingress를 기본 차단하려면 다음과 같이 작성할 수 있다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

`podSelector: {}`는 namespace 안의 모든 Pod를 선택한다.

이 policy를 적용하면 ingress 방향에서 명시적으로 허용된 traffic만 들어올 수 있다.

이후 필요한 traffic을 별도 policy로 열어준다.

예를 들어 frontend에서 backend로 들어오는 TCP 8080만 허용한다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

이 모델은 보안상 좋은 출발점이 될 수 있지만, 처음부터 모든 namespace에 적용하면 장애를 만들기 쉽다.

적용 전에는 반드시 필요한 통신 경로를 목록화해야 한다.

## 08. NetworkPolicy는 additively allow다

NetworkPolicy에는 일반적인 방화벽처럼 explicit deny rule이 없다.

여러 NetworkPolicy가 같은 Pod를 선택하면, 허용되는 traffic은 각 policy의 allow rule 합집합으로 계산된다.

예를 들어 backend Pod에 다음 두 policy가 적용된다고 하자.

```text
policy A: frontend → backend:8080 허용
policy B: admin → backend:9090 허용
```

그러면 backend Pod는 두 traffic을 모두 허용한다.

```text
frontend → backend:8080 허용
admin → backend:9090 허용
```

한 policy에서 열어둔 traffic을 다른 policy가 다시 닫는 구조가 아니다.

따라서 NetworkPolicy를 설계할 때는 "어떤 policy가 이 Pod를 선택하고 있는가"를 모두 확인해야 한다.

```bash
kubectl get networkpolicy
kubectl describe networkpolicy <name>
```

문제가 생겼을 때는 개별 policy 하나만 보지 말고, 같은 Pod에 적용되는 모든 policy를 함께 봐야 한다.

## 09. CNI가 enforcement를 담당한다

NetworkPolicy 리소스를 만든다고 해서 항상 traffic이 제어되는 것은 아니다.

실제 enforcement는 CNI plugin이 담당한다.

만약 사용하는 CNI가 NetworkPolicy를 지원하지 않거나, 정책 기능이 꺼져 있다면 NetworkPolicy 객체를 만들어도 traffic이 막히지 않을 수 있다.

따라서 NetworkPolicy를 운영하려면 먼저 확인해야 한다.

- 현재 CNI가 NetworkPolicy를 지원하는가?
- ingress와 egress를 모두 지원하는가?
- hostNetwork Pod는 어떻게 처리되는가?
- Node traffic은 policy 대상에 어떻게 반영되는가?
- policy 변경이 dataplane에 반영되는 데 지연이 있는가?

Kubernetes 리소스만 보고 "policy가 있으니 막힐 것이다"라고 판단하면 안 된다. 실제 dataplane에서 enforcement가 되는지 확인해야 한다.

## 10. 네트워크 디버깅의 기본 원칙

Kubernetes 네트워크 문제는 범위가 넓다.

하지만 대부분은 계층을 나누어 보면 좁힐 수 있다.

가장 먼저 질문을 분리한다.

```text
이름 해석이 실패하는가?
TCP 연결이 실패하는가?
연결은 되는데 HTTP 응답이 이상한가?
특정 Pod에서만 실패하는가?
특정 node에서만 실패하는가?
외부에서만 실패하는가?
```

증상별로 봐야 할 계층이 다르다.

| 증상 | 먼저 볼 것 |
| --- | --- |
| `Could not resolve host` | DNS, CoreDNS, resolv.conf, NetworkPolicy egress |
| `Connection refused` | application listen port, targetPort, Pod readiness |
| `Connection timed out` | NetworkPolicy, route, CNI, kube-proxy, firewall |
| 간헐적 실패 | endpoint 변화, conntrack, MTU, node별 문제 |
| 외부에서만 실패 | LoadBalancer, Ingress/Gateway, externalTrafficPolicy |
| 같은 노드만 성공 | cross-node routing, overlay, security group |

이 표를 기준으로 처음 볼 위치를 정하면 시간을 줄일 수 있다.

## 11. 내부 Service 디버깅 체크리스트

`frontend` Pod에서 `backend` Service 호출이 안 된다고 해보자.

먼저 DNS를 확인한다.

```bash
kubectl exec -it frontend -- nslookup backend
```

DNS가 실패하면 CoreDNS와 NetworkPolicy egress를 본다.

DNS가 성공하면 ClusterIP로 직접 접근한다.

```bash
kubectl exec -it frontend -- curl -v http://backend
kubectl exec -it frontend -- curl -v http://<cluster-ip>
```

Service와 EndpointSlice를 확인한다.

```bash
kubectl get svc backend
kubectl describe svc backend
kubectl get endpointslice -l kubernetes.io/service-name=backend
```

backend Pod가 ready인지 본다.

```bash
kubectl get pod -l app=backend -o wide
kubectl describe pod <backend-pod>
```

application이 실제 port에서 listen 중인지 확인한다.

```bash
kubectl exec -it <backend-pod> -- ss -lntp
```

NetworkPolicy를 확인한다.

```bash
kubectl get networkpolicy
kubectl describe networkpolicy
```

이 순서만 지켜도 많은 문제를 빠르게 좁힐 수 있다.

## 12. Pod-to-Pod 디버깅 체크리스트

Service를 거치지 않고 Pod IP로 직접 통신이 안 된다면 CNI 경로를 봐야 한다.

먼저 두 Pod가 어느 노드에 있는지 확인한다.

```bash
kubectl get pod -o wide
```

같은 노드인지 다른 노드인지에 따라 의심 지점이 달라진다.

같은 노드에서만 실패한다면 다음을 본다.

- Pod network namespace
- veth pair
- bridge 또는 local routing
- local policy enforcement

다른 노드에서만 실패한다면 다음을 본다.

- node 간 통신
- Pod CIDR route
- overlay tunnel
- MTU
- cloud security group 또는 firewall

노드에서 route lookup을 해본다.

```bash
ip route get <destination-pod-ip>
```

가능하면 tcpdump로 packet을 본다.

```bash
tcpdump -ni any host <destination-pod-ip>
```

source node에서는 보이는데 destination node에서는 안 보이면 node 간 경로 문제다.

destination node에서는 보이는데 Pod로 안 들어가면 local forwarding, policy, veth 경로를 의심한다.

Pod까지 들어가는데 application 응답이 없으면 네트워크보다 application listen 또는 firewall 설정을 봐야 한다.

## 13. 외부 traffic 디버깅 체크리스트

외부에서 서비스 접근이 안 된다면 바깥에서 안쪽으로 들어오며 확인한다.

DNS를 본다.

```bash
dig api.example.com
```

LoadBalancer 주소를 본다.

```bash
kubectl get svc -A | grep LoadBalancer
```

Ingress 또는 Gateway 상태를 본다.

```bash
kubectl get ingress -A
kubectl describe ingress <name>

kubectl get gateway -A
kubectl get httproute -A
```

controller log를 확인한다.

```bash
kubectl logs -n <namespace> deploy/<controller>
```

backend Service와 EndpointSlice를 본다.

```bash
kubectl get svc backend
kubectl get endpointslice -l kubernetes.io/service-name=backend
```

여기서 중요한 것은 외부 404와 backend connection timeout을 구분하는 것이다.

- 404가 controller에서 나온다면 route match 문제일 수 있다.
- 502/503은 backend endpoint 또는 upstream 연결 문제일 수 있다.
- timeout은 load balancer, firewall, NetworkPolicy, Service dataplane 문제일 수 있다.
- TLS error는 certificate, SNI, Secret, termination 위치 문제일 수 있다.

HTTP status code와 error message를 그냥 넘기지 말고 어느 계층에서 발생했는지 해석해야 한다.

## 14. 자주 만나는 실수들

Kubernetes 네트워크에서 자주 만나는 실수는 꽤 반복적이다.

### selector와 label 불일치

Service selector가 Pod label과 맞지 않으면 EndpointSlice가 비어 있다.

```bash
kubectl get endpointslice -l kubernetes.io/service-name=<service>
```

endpoint가 없다면 먼저 selector를 보자.

### targetPort 불일치

Service port는 맞는데 targetPort가 container가 실제 listen하는 port와 다를 수 있다.

```yaml
ports:
  - port: 80
    targetPort: 8080
```

Pod 안에서 listen port를 확인하자.

```bash
ss -lntp
```

### readiness 실패

Pod는 Running이지만 Ready가 아니면 Service endpoint에서 제외될 수 있다.

```bash
kubectl get pod
kubectl describe pod <pod>
```

### NetworkPolicy로 DNS 차단

default deny egress를 적용하고 DNS를 열지 않으면 이름 해석이 실패한다.

### externalTrafficPolicy Local

`externalTrafficPolicy: Local`을 사용했는데 traffic이 들어오는 node에 local endpoint가 없으면 외부 요청이 실패할 수 있다.

### MTU 문제

overlay 환경에서 MTU가 맞지 않으면 작은 요청은 되는데 큰 요청이 실패할 수 있다.

### kube-proxy mode 착각

iptables rule을 찾고 있는데 실제로는 IPVS, nftables, eBPF dataplane을 쓰고 있을 수 있다.

먼저 dataplane이 무엇인지 확인해야 한다.

## 15. 시리즈 핵심 정리

이번 시리즈에서 계속 반복한 관점은 하나다.

> Kubernetes 네트워크는 추상화 이름만 외우는 것이 아니라 packet path를 그릴 수 있어야 이해된다.

전체 흐름을 다시 연결하면 다음과 같다.

```text
Pod
  → network namespace
  → veth
  → CNI
  → Pod-to-Pod routing
  → Service
  → EndpointSlice
  → kube-proxy or dataplane
  → DNS
  → Ingress/Gateway
  → NetworkPolicy
```

각각의 리소스는 독립적으로 존재하는 것처럼 보이지만, 실제 장애 상황에서는 서로 연결되어 있다.

Service가 안 된다고 해서 Service만 보면 부족하다.

DNS가 안 되는 것인지, EndpointSlice가 비어 있는 것인지, kube-proxy rule이 없는 것인지, NetworkPolicy가 막는 것인지, CNI route가 깨진 것인지 나누어 봐야 한다.

Kubernetes 네트워크를 잘 이해한다는 것은 다음 질문에 답할 수 있다는 뜻이다.

- 이 요청의 source와 destination은 무엇인가?
- 이름은 어떤 IP로 해석되는가?
- Service IP는 어떤 endpoint로 바뀌는가?
- packet은 같은 노드에서 끝나는가, 다른 노드로 가는가?
- NAT나 conntrack이 개입하는가?
- policy가 이 traffic을 허용하는가?
- 실패한다면 어느 계층에서 실패하는가?

이 질문들을 따라가면 복잡해 보이는 Kubernetes 네트워크도 단계별로 해석할 수 있다.

## 16. 이번 편의 핵심 정리

마지막 글에서는 NetworkPolicy와 디버깅 흐름을 정리했다.

핵심은 다음과 같다.

- NetworkPolicy는 Pod 중심의 L3/L4 traffic 제어 모델이다.
- 아무 policy도 없으면 기본적으로 traffic은 허용된다.
- policy가 Pod를 선택하면 해당 방향의 traffic은 명시적으로 허용된 것만 가능하다.
- NetworkPolicy는 explicit deny가 아니라 allow rule의 합집합 모델로 이해해야 한다.
- egress를 막으면 DNS traffic도 함께 고려해야 한다.
- 실제 enforcement는 CNI가 담당한다.
- 네트워크 문제는 DNS, Service, EndpointSlice, dataplane, CNI, policy, application 계층으로 나누어 봐야 한다.

이제 Kubernetes 네트워크를 볼 때 적어도 어디서부터 시작해야 할지, 어떤 순서로 내려가야 할지, 각 리소스가 packet path에서 어떤 역할을 하는지 연결해서 볼 수 있다.
