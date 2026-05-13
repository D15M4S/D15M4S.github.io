---
title: "쿠버네티스 Deep Dive - 네트워크 편 7 | Ingress와 Gateway API"
published: 2026-05-13
description: "클러스터 밖에서 들어오는 HTTP traffic이 LoadBalancer, Ingress Controller, Gateway Controller, Service, Pod로 이어지는 흐름을 정리합니다."
image: "/assets/series/kubernetes-network-deep-dive.png"
tags: ["Kubernetes", "Network", "Ingress", "Gateway API", "LoadBalancer", "HTTPRoute"]
category: "Kubernetes"
draft: true
lang: "ko"
cropCover: false
coverLayout: "wide"
series: "kubernetes-network-deep-dive"
seriesOrder: 7
---

지금까지는 주로 클러스터 내부 통신을 봤다.

- Pod-to-Pod
- Pod-to-Service
- Service DNS
- kube-proxy와 virtual IP

이번 편에서는 방향을 바꿔 클러스터 밖에서 들어오는 traffic을 본다.

사용자는 보통 다음과 같은 주소로 서비스에 접근한다.

```text
https://api.example.com
```

이 요청은 어떻게 Kubernetes 안의 Pod까지 도착할까?

대략적인 흐름은 다음과 같다.

```text
client
  → external load balancer
  → ingress/gateway data plane
  → Service
  → Pod
```

이 경로를 이해하려면 Service, Ingress, Gateway API의 역할을 구분해야 한다.

## 01. Service만으로는 무엇이 부족한가?

Service type `LoadBalancer`를 사용하면 외부 진입점을 만들 수 있다.

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

이 구조는 단순하다.

```text
external client
  → load balancer
  → backend Service
  → backend Pod
```

하지만 HTTP 서비스를 운영하다 보면 더 복잡한 요구가 생긴다.

- `api.example.com`은 API Service로 보내고 싶다.
- `www.example.com`은 Web Service로 보내고 싶다.
- `/api` path는 API로, `/static` path는 static server로 보내고 싶다.
- TLS 인증서를 연결하고 싶다.
- header나 path 기반 routing을 하고 싶다.
- 여러 팀이 각자 route를 관리하고 싶다.

Service는 L4 load balancing에 가까운 추상화다. HTTP host/path routing 같은 L7 요구를 Service만으로 표현하기에는 한계가 있다.

그래서 Ingress와 Gateway 계층이 등장한다.

## 02. Ingress의 역할

Ingress는 HTTP/HTTPS route를 표현하는 Kubernetes 리소스다.

예를 들어 다음과 같은 규칙을 선언할 수 있다.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backend
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 80
```

이 Ingress는 다음 의미를 가진다.

```text
Host: api.example.com
Path: /
  → backend Service:80
```

중요한 점은 Ingress 리소스 자체가 traffic을 처리하지 않는다는 것이다.

Ingress는 desired state다. 실제 traffic 처리는 Ingress Controller가 한다.

```text
Ingress resource
  → Ingress Controller가 watch
  → proxy/load balancer 설정 생성
  → traffic 처리
```

예를 들어 NGINX Ingress Controller, HAProxy Ingress, cloud provider의 L7 load balancer controller 등이 이 역할을 할 수 있다.

## 03. Ingress Controller는 dataplane을 가진다

Ingress를 이해할 때 control plane과 dataplane을 나누어야 한다.

```text
control plane:
  Ingress resource
  Service
  EndpointSlice
  Ingress Controller watch loop

dataplane:
  NGINX / Envoy / cloud load balancer / proxy
```

Ingress Controller는 Kubernetes API를 watch하면서 Ingress rule을 읽는다.

그리고 자신이 관리하는 proxy 설정을 갱신한다.

외부 요청이 들어오면 proxy가 HTTP host/path를 보고 어느 Service로 보낼지 결정한다.

```text
client
  → Ingress Controller
  → host/path match
  → Service
  → Pod
```

Ingress 문제를 볼 때는 단순히 Ingress YAML만 봐서는 부족하다.

다음을 함께 봐야 한다.

- IngressClass가 올바른 controller를 가리키는가?
- Ingress Controller Pod가 정상인가?
- Ingress Controller 앞의 LoadBalancer가 정상인가?
- Ingress rule이 기대한 Service를 가리키는가?
- Service의 EndpointSlice가 비어 있지 않은가?
- TLS secret이 올바른 namespace에 있는가?

## 04. pathType 이해하기

Ingress path에는 `pathType`이 필요하다.

대표적으로 다음이 있다.

- `Exact`
- `Prefix`
- `ImplementationSpecific`

`Exact`는 말 그대로 정확히 일치하는 path를 의미한다.

```yaml
path: /api
pathType: Exact
```

이 경우 `/api`는 match되지만 `/api/users`는 다르게 처리될 수 있다.

`Prefix`는 path prefix 기반 match다.

```yaml
path: /api
pathType: Prefix
```

이 경우 `/api/users`, `/api/v1/orders` 같은 path가 같은 backend로 갈 수 있다.

`ImplementationSpecific`은 controller 구현에 맡기는 방식이다. controller마다 해석이 달라질 수 있으므로 이식성이 중요하다면 조심해서 사용해야 한다.

운영에서는 path match가 생각보다 많은 문제를 만든다.

- `/api`와 `/api/`가 다르게 보인다.
- rewrite rule이 controller annotation에 숨어 있다.
- controller마다 regex 지원 방식이 다르다.
- trailing slash 때문에 redirect loop가 생긴다.

Ingress를 사용할 때는 controller별 annotation과 path 처리 방식을 반드시 함께 봐야 한다.

## 05. TLS와 Ingress

Ingress는 TLS 설정도 표현할 수 있다.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backend
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
      secretName: api-example-com-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 80
```

여기서 `secretName`은 TLS certificate와 private key가 들어 있는 Secret을 가리킨다.

TLS termination이 어디서 일어나는지는 구성에 따라 달라진다.

```text
client
  → external load balancer에서 TLS 종료
  → Ingress Controller로 HTTP 전달
```

또는

```text
client
  → Ingress Controller에서 TLS 종료
  → Service로 HTTP 전달
```

또는 backend까지 TLS를 유지하는 구조도 가능하다.

중요한 것은 "TLS가 어디서 끝나는가"를 명확히 아는 것이다.

TLS 문제를 볼 때는 certificate 자체뿐 아니라 다음을 함께 확인해야 한다.

- DNS가 올바른 load balancer를 가리키는가?
- SNI host와 certificate SAN이 맞는가?
- Secret이 올바른 namespace에 있는가?
- Ingress Controller가 Secret을 읽을 권한이 있는가?
- controller가 설정을 reload했는가?

## 06. Gateway API가 등장하는 이유

Ingress는 단순한 HTTP routing에는 유용하지만, 복잡한 운영 요구를 표현하기에는 한계가 있다.

특히 다음과 같은 요구가 많아졌다.

- infrastructure 담당자와 application 담당자의 역할 분리
- 여러 namespace의 route를 하나의 gateway에 연결
- route attachment에 대한 명확한 권한 모델
- HTTP header 기반 match
- traffic weight 기반 분산
- gRPC routing
- TCP/UDP 같은 다양한 protocol 확장
- controller별 annotation에 덜 의존하는 표현

Gateway API는 이런 요구를 더 구조적으로 표현하기 위한 모델이다.

핵심은 역할을 나누는 것이다.

```text
GatewayClass
  → 어떤 controller가 gateway를 구현하는가

Gateway
  → traffic을 받을 listener와 address

HTTPRoute
  → 어떤 host/path/header traffic을 어느 backend로 보낼 것인가
```

Ingress가 하나의 리소스에 많은 것을 담았다면, Gateway API는 역할별 리소스로 나누어 표현한다.

## 07. GatewayClass, Gateway, HTTPRoute

Gateway API의 기본 관계를 보자.

```text
GatewayClass
  └── Gateway
        └── HTTPRoute
              └── Service
```

`GatewayClass`는 어떤 controller가 Gateway를 관리할지 정의한다.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: example
spec:
  controllerName: example.com/gateway-controller
```

`Gateway`는 실제 traffic을 받을 listener를 정의한다.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public-gateway
spec:
  gatewayClassName: example
  listeners:
    - name: http
      protocol: HTTP
      port: 80
```

`HTTPRoute`는 HTTP routing rule을 정의하고 Gateway에 붙는다.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: backend
spec:
  parentRefs:
    - name: public-gateway
  hostnames:
    - api.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: backend
          port: 80
```

이 구조의 장점은 책임이 분리된다는 점이다.

cluster operator는 Gateway를 만들고, application team은 자신들의 HTTPRoute를 붙일 수 있다.

## 08. Gateway API의 request 흐름

Gateway API를 사용하더라도 packet 흐름 자체는 여전히 Service와 Pod로 이어진다.

```text
client
  → Gateway dataplane
  → listener match
  → HTTPRoute match
  → backendRef Service
  → EndpointSlice
  → Pod
```

Gateway API는 traffic을 받을 입구와 route를 더 명확하게 모델링한다.

하지만 결국 backend는 Service다.

따라서 Gateway 문제도 아래로 내려가면 Service와 EndpointSlice 문제로 이어진다.

```text
Gateway가 정상인가?
  → HTTPRoute가 Gateway에 attach 되었는가?
  → backendRef Service가 존재하는가?
  → Service endpoint가 있는가?
  → Pod가 ready인가?
```

Gateway API를 볼 때는 status condition을 적극적으로 확인해야 한다.

```bash
kubectl get gateway
kubectl describe gateway public-gateway
kubectl get httproute
kubectl describe httproute backend
```

`Accepted`, `Programmed`, `ResolvedRefs` 같은 condition은 route가 실제로 받아들여졌는지 판단하는 데 중요하다.

## 09. Ingress와 Gateway API 비교

둘을 단순히 신구 관계로만 보면 부족하다.

운영 관점에서는 다음처럼 비교할 수 있다.

| 구분 | Ingress | Gateway API |
| --- | --- | --- |
| 기본 목적 | HTTP/HTTPS routing | 역할 기반 traffic routing 모델 |
| 핵심 리소스 | Ingress | GatewayClass, Gateway, HTTPRoute 등 |
| 역할 분리 | 제한적 | 더 명확함 |
| 확장성 | annotation 의존이 많음 | 리소스 모델로 표현 |
| 복잡한 routing | controller별 차이가 큼 | 더 풍부한 표현 가능 |
| backend | Service | 주로 Service |

작은 서비스나 단순 HTTP routing에는 Ingress가 여전히 충분할 수 있다.

반면 여러 팀이 하나의 gateway를 공유하거나, 복잡한 routing 정책을 선언적으로 관리하려면 Gateway API가 더 잘 맞을 수 있다.

중요한 것은 어떤 리소스를 쓰든 실제 요청 경로를 그릴 수 있어야 한다는 점이다.

## 10. 외부 traffic을 디버깅하는 순서

외부에서 접속이 안 될 때는 바깥에서 안쪽으로 들어오며 확인하는 것이 좋다.

먼저 DNS가 올바른 주소를 가리키는지 본다.

```bash
dig api.example.com
```

외부 load balancer 주소를 확인한다.

```bash
kubectl get svc -A | grep LoadBalancer
```

Ingress 또는 Gateway 상태를 확인한다.

```bash
kubectl get ingress -A
kubectl describe ingress <name>

kubectl get gateway -A
kubectl get httproute -A
```

controller Pod 상태를 본다.

```bash
kubectl get pod -A | grep ingress
kubectl get pod -A | grep gateway
```

backend Service와 EndpointSlice를 확인한다.

```bash
kubectl get svc backend
kubectl get endpointslice -l kubernetes.io/service-name=backend
```

마지막으로 backend Pod가 실제로 listen 중인지 확인한다.

```bash
kubectl exec -it backend-pod -- ss -lntp
```

문제를 나누면 다음과 같다.

```text
DNS 문제인가?
LoadBalancer 문제인가?
Controller 문제인가?
Route match 문제인가?
Service/EndpointSlice 문제인가?
Pod application 문제인가?
```

한 번에 모든 것을 의심하면 오래 걸린다. 계층을 나누어 하나씩 제거하는 것이 가장 빠르다.

## 11. 이번 편의 핵심 정리

이번 글에서는 Ingress와 Gateway API를 정리했다.

핵심은 다음과 같다.

- Service type LoadBalancer는 외부 진입점을 만들 수 있지만 L7 routing 표현에는 한계가 있다.
- Ingress는 HTTP/HTTPS host/path routing을 표현하는 리소스다.
- Ingress resource 자체가 traffic을 처리하는 것이 아니라 Ingress Controller가 처리한다.
- Gateway API는 GatewayClass, Gateway, HTTPRoute 등 역할별 리소스로 traffic routing을 표현한다.
- Gateway API는 역할 분리와 확장성, 복잡한 routing 표현에 강점이 있다.
- Ingress든 Gateway API든 최종 backend는 대개 Service이고, Service 뒤에는 EndpointSlice와 Pod가 있다.
- 외부 traffic 문제는 DNS → LoadBalancer → Controller → Route → Service → Pod 순서로 나누어 봐야 한다.

이제 클러스터 안팎의 주요 traffic 흐름을 대부분 살펴봤다.

마지막 편에서는 traffic을 허용하거나 차단하는 NetworkPolicy와, 실제 장애 상황에서 네트워크 문제를 어떻게 좁혀갈지 정리한다.
