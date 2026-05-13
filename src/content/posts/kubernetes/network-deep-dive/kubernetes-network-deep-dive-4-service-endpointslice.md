---
title: "쿠버네티스 Deep Dive - 네트워크 편 4 | Service와 EndpointSlice"
published: 2026-05-13
description: "변하는 Pod 집합 앞에서 Service가 안정적인 진입점을 제공하는 방식과 EndpointSlice가 실제 backend 목록을 표현하는 구조를 정리합니다."
image: "/assets/series/kubernetes-network-deep-dive.png"
tags: ["Kubernetes", "Network", "Service", "EndpointSlice", "ClusterIP", "Headless"]
category: "Kubernetes"
draft: true
lang: "ko"
cropCover: false
coverLayout: "wide"
series: "kubernetes-network-deep-dive"
seriesOrder: 4
---

Pod-to-Pod 통신만 보면 Pod IP를 직접 알면 통신할 수 있다.

하지만 실제 애플리케이션에서는 Pod IP를 직접 사용하는 방식이 오래 버티기 어렵다.

Pod는 계속 바뀐다.

- Deployment rollout 중 새 Pod가 생긴다.
- 기존 Pod가 종료된다.
- 장애로 Pod가 다른 노드에 다시 생성된다.
- HPA에 의해 replica 수가 늘거나 줄어든다.
- readiness 상태에 따라 트래픽을 받아야 할 Pod가 바뀐다.

이때 client가 Pod IP 목록을 직접 관리하면 애플리케이션은 Kubernetes의 동적인 환경을 감당하기 어렵다.

그래서 Service가 필요하다.

> Service는 변하는 Pod 집합 앞에 안정적인 진입점을 제공한다.

이번 글에서는 Service가 무엇을 추상화하는지, EndpointSlice가 왜 필요한지, 그리고 Service type별로 어떤 의미가 있는지 정리한다.

## 01. Service가 해결하는 문제

먼저 Deployment가 있다고 해보자.

```text
backend Deployment
├── backend-1: 10.244.1.11
├── backend-2: 10.244.2.17
└── backend-3: 10.244.3.25
```

frontend는 backend로 요청을 보내야 한다.

Pod IP를 직접 사용한다면 frontend는 세 IP를 알고 있어야 한다.

```text
10.244.1.11
10.244.2.17
10.244.3.25
```

그런데 rollout이 일어나면 이 목록은 바뀐다.

```text
backend-1 deleted
backend-4 created: 10.244.2.31
```

frontend가 이 변화를 직접 추적하는 것은 좋은 구조가 아니다.

Service는 이 문제를 다음 방식으로 해결한다.

```text
frontend
  → backend Service
  → 현재 준비된 backend Pod 중 하나
```

frontend는 Service 이름 또는 ClusterIP만 알면 된다. 실제 backend Pod 목록은 Kubernetes가 관리한다.

## 02. selector가 Pod 집합을 고른다

가장 일반적인 Service는 selector를 가진다.

예를 들어 다음 Service를 보자.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  selector:
    app: backend
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

이 Service는 `app=backend` label을 가진 Pod들을 backend 후보로 본다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  labels:
    app: backend
spec:
  containers:
    - name: app
      image: example/backend
      ports:
        - containerPort: 8080
```

여기서 `port`와 `targetPort`를 구분해야 한다.

- `port`: Service가 노출하는 port
- `targetPort`: 실제 Pod container로 전달할 port

client는 Service의 `80`번 port로 접근하지만, traffic은 backend Pod의 `8080`번 port로 전달될 수 있다.

```text
client → Service backend:80 → Pod IP:8080
```

이 매핑은 Service를 이해할 때 아주 중요하다.

## 03. EndpointSlice는 실제 backend 목록이다

Service가 selector를 통해 Pod를 고르면, Kubernetes는 그 결과를 EndpointSlice로 표현한다.

Service 자체는 "어떤 Pod들을 대상으로 할 것인가"를 정의한다. EndpointSlice는 "현재 실제로 어디로 보낼 수 있는가"에 더 가깝다.

간단히 말하면 다음 관계다.

```text
Service
  selector: app=backend
        ↓
EndpointSlice
  endpoints:
    - 10.244.1.11
    - 10.244.2.17
    - 10.244.3.25
```

확인은 다음 명령으로 할 수 있다.

```bash
kubectl get endpointslice
kubectl describe endpointslice <name>
```

EndpointSlice에는 endpoint address뿐 아니라 port, protocol, readiness 관련 condition, topology 관련 hint 같은 정보도 들어갈 수 있다.

이 정보는 kube-proxy나 다른 dataplane 구현이 Service traffic을 실제 Pod로 전달하는 데 사용된다.

## 04. 왜 Endpoints가 아니라 EndpointSlice인가?

예전에는 Service backend 목록을 Endpoints 리소스가 표현했다.

하지만 클러스터가 커지면 하나의 Endpoints 객체에 너무 많은 backend가 들어가는 문제가 생긴다.

EndpointSlice는 backend 목록을 여러 조각으로 나누어 관리할 수 있다.

```text
backend Service
├── EndpointSlice A: 100 endpoints
├── EndpointSlice B: 100 endpoints
└── EndpointSlice C: 80 endpoints
```

이렇게 나누면 변경 전파와 watch 효율을 개선할 수 있다.

예를 들어 backend Pod 하나가 readiness를 잃었을 때, 거대한 단일 Endpoints 객체 전체를 다시 다루는 것보다 관련 EndpointSlice 일부만 갱신하는 편이 낫다.

또 EndpointSlice는 dual-stack, topology, endpoint condition 같은 정보를 표현하기에도 더 적합하다.

따라서 Service를 볼 때는 Service 자체만 보지 말고 EndpointSlice까지 함께 봐야 한다.

## 05. ClusterIP Service

가장 기본적인 Service type은 `ClusterIP`다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080
```

ClusterIP Service에는 클러스터 내부에서 사용할 수 있는 가상 IP가 할당된다.

```bash
kubectl get svc backend
```

예시는 다음과 같다.

```text
NAME      TYPE        CLUSTER-IP     PORT(S)
backend   ClusterIP   10.96.10.25    80/TCP
```

client는 `10.96.10.25:80`으로 요청을 보낸다. 그러면 dataplane은 이 요청을 EndpointSlice에 있는 실제 Pod IP와 port로 전달한다.

```text
10.96.10.25:80
  → 10.244.1.11:8080
  or 10.244.2.17:8080
  or 10.244.3.25:8080
```

중요한 점은 ClusterIP가 일반적인 Pod IP처럼 특정 Pod에 붙어 있는 IP가 아니라는 것이다.

ClusterIP는 Service를 표현하는 virtual IP다. 이 virtual IP가 실제로 어떻게 backend Pod로 바뀌는지는 다음 편에서 kube-proxy와 함께 자세히 본다.

## 06. NodePort Service

`NodePort`는 각 노드의 특정 port를 통해 Service에 접근할 수 있게 한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  type: NodePort
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30080
```

이 경우 각 노드에서 다음 주소로 접근할 수 있다.

```text
<node-ip>:30080
```

요청은 Service backend 중 하나로 전달된다.

```text
external client
  → node-1:30080
  → backend Pod
```

NodePort는 단독으로도 사용할 수 있지만, LoadBalancer나 Ingress/Gateway controller 앞단에서 내부 경로로 사용되는 경우도 많다.

주의할 점은 NodePort가 모든 노드에서 열리는 port처럼 보일 수 있다는 것이다. 실제 운영에서는 방화벽, security group, node 접근 제어까지 함께 고려해야 한다.

## 07. LoadBalancer Service

`LoadBalancer` type은 외부 load balancer와 연결되는 Service다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  type: LoadBalancer
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080
```

cloud 환경에서는 cloud controller가 외부 load balancer를 만들고, 그 주소를 Service에 연결할 수 있다.

```text
external client
  → cloud load balancer
  → node
  → Service dataplane
  → backend Pod
```

환경에 따라 load balancer가 node로 전달하는 방식은 다를 수 있다. NodePort를 경유할 수도 있고, cloud provider나 CNI가 더 직접적인 방식으로 Pod 또는 node endpoint를 다룰 수도 있다.

중요한 것은 `LoadBalancer` Service가 외부 진입점을 만든다는 점이다.

다만 L7 HTTP routing까지 Service가 직접 담당하는 것은 아니다. host/path 기반 routing은 보통 Ingress나 Gateway 계층에서 다룬다.

## 08. ExternalName Service

`ExternalName`은 조금 특이한 Service type이다.

Pod 집합을 backend로 갖는 대신, 외부 DNS 이름을 가리킨다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  type: ExternalName
  externalName: db.example.com
```

이 Service는 ClusterIP를 통해 traffic을 proxy하는 구조가 아니다. DNS 수준에서 `external-db`라는 이름을 외부 이름으로 연결하는 방식에 가깝다.

따라서 ExternalName을 사용할 때는 다음을 구분해야 한다.

- ClusterIP Service: Service IP가 있고 dataplane이 backend로 전달한다.
- ExternalName Service: DNS alias처럼 동작한다.

ExternalName은 외부 dependency를 Kubernetes 내부 이름으로 감싸고 싶을 때 사용할 수 있지만, TCP 연결이나 TLS hostname 검증 관점에서는 주의가 필요하다.

## 09. Headless Service

Headless Service는 ClusterIP가 없는 Service다.

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

Headless Service는 하나의 virtual IP를 제공하기보다, backend Pod IP 목록을 DNS로 드러내는 데 가깝다.

일반 ClusterIP Service는 DNS 조회 결과로 Service의 ClusterIP를 반환한다.

```text
backend.default.svc.cluster.local
  → 10.96.10.25
```

Headless Service는 backend Pod IP들을 반환할 수 있다.

```text
backend.default.svc.cluster.local
  → 10.244.1.11
  → 10.244.2.17
  → 10.244.3.25
```

이 구조는 StatefulSet처럼 각 Pod의 정체성이 중요한 경우 자주 사용된다.

예를 들어 `mysql-0`, `mysql-1`, `mysql-2` 같은 Pod를 각각 안정적인 DNS 이름으로 접근해야 한다면 Headless Service가 중요한 역할을 한다.

## 10. selector 없는 Service

Service가 항상 Pod selector를 가져야 하는 것은 아니다.

selector 없는 Service를 만들고, EndpointSlice를 직접 연결하면 Kubernetes 밖의 backend나 직접 관리하는 endpoint를 Service 뒤에 둘 수 있다.

예를 들어 다음과 같은 경우가 있다.

- Kubernetes 밖의 legacy database를 내부 Service 이름으로 감싸고 싶다.
- 다른 cluster의 endpoint를 임시로 연결하고 싶다.
- migration 중 외부 backend와 내부 backend를 같은 이름 뒤에서 다루고 싶다.

이 경우 Service는 안정적인 이름과 port를 제공하고, EndpointSlice가 실제 endpoint를 제공한다.

다만 selector가 없으면 Kubernetes가 Pod label을 기준으로 EndpointSlice를 자동 생성하지 않는다. endpoint 관리를 직접 책임져야 한다.

## 11. readiness와 Service traffic

Service는 단순히 label이 맞는 모든 Pod로 traffic을 보내는 것처럼 보일 수 있지만, 실제로는 readiness가 중요하다.

Pod가 아직 요청을 받을 준비가 되지 않았다면 Service backend로 포함되면 안 된다.

readiness probe는 이 지점을 제어한다.

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
```

Pod가 ready 상태가 되면 EndpointSlice에서 traffic을 받을 수 있는 endpoint로 취급된다. ready가 아니면 일반적인 Service traffic 대상에서 제외된다.

이것은 rollout 안정성에 매우 중요하다.

새 Pod가 생성되었지만 아직 warm-up 중이라면 Service traffic을 받지 않아야 한다. readiness가 제대로 잡혀 있으면 Service는 준비된 Pod에만 traffic을 보낸다.

## 12. Service를 디버깅하는 순서

Service 통신이 안 될 때는 다음 순서로 보는 것이 좋다.

먼저 Service 자체를 확인한다.

```bash
kubectl get svc backend
kubectl describe svc backend
```

selector가 기대한 label과 맞는지 본다.

```bash
kubectl get pod --show-labels
```

EndpointSlice를 확인한다.

```bash
kubectl get endpointslice -l kubernetes.io/service-name=backend
kubectl describe endpointslice <name>
```

EndpointSlice에 backend IP가 없다면 dataplane 문제가 아니라 Service가 보낼 대상이 없는 상태다.

이 경우 주로 다음을 의심한다.

- selector와 Pod label이 맞지 않는다.
- Pod가 ready 상태가 아니다.
- Service port와 targetPort가 맞지 않는다.
- named port를 사용했는데 Pod port name이 일치하지 않는다.

EndpointSlice에는 정상적으로 backend가 있는데 연결이 안 된다면 그때는 kube-proxy, CNI, NetworkPolicy, application listen address를 이어서 봐야 한다.

## 13. 이번 편의 핵심 정리

이번 글에서는 Service와 EndpointSlice를 정리했다.

핵심은 다음과 같다.

- Service는 변하는 Pod 집합 앞에 안정적인 진입점을 제공한다.
- selector는 어떤 Pod들을 backend 후보로 볼지 결정한다.
- EndpointSlice는 현재 실제 backend endpoint 목록을 표현한다.
- ClusterIP는 클러스터 내부 virtual IP다.
- NodePort는 각 노드의 port를 통해 Service에 접근하게 한다.
- LoadBalancer는 외부 진입점과 Service를 연결한다.
- ExternalName은 DNS alias에 가깝다.
- Headless Service는 ClusterIP 없이 backend IP들을 DNS로 드러낼 수 있다.
- Service 문제는 Service → selector → EndpointSlice → dataplane 순서로 나눠서 봐야 한다.

아직 남은 중요한 질문이 있다.

> ClusterIP는 실제 Pod에 붙어 있는 IP가 아닌데, 어떻게 요청이 backend Pod로 전달될까?

다음 편에서는 이 질문을 다룬다. kube-proxy와 virtual IP, 그리고 iptables/IPVS/nftables 기반 Service dataplane을 살펴보자.
