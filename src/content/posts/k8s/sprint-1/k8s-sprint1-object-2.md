---
title: "쿠버네티스 Sprint 1 - Object 그려보며 이해하기 1. Selector, Deployment, Service"
published: 2026-03-10
description: "인프런 '쿠버네티스 어나더 클래스 - Sprint 1, 지상편'의 'Object 그려보며 이해하기'를 바탕으로, Selector, Deployment, Service가 어떻게 연결되는지 제 이해와 해설을 덧붙여 정리한 글입니다."
image: "/assets/posts/k8s/k8s-sprint1-object-1_main.jpg"
tags: ["Kubernetes", "Deployment", "Service", "Object"]
category: "Kubernetes"
draft: false
lang: "ko"
---

이번 글은 [쿠버네티스 Warm-up - Namespace, Pod, Label, Selector](/posts/k8s/sprint-1/k8s-sprint1-object/)에 이어, 본격적으로 `Object 그려보며 이해하기`를 정리한 첫 번째 글입니다. 이전 글에서는 `Namespace`, `Pod`, `Label`, `Selector`를 Sprint 1에 들어가기 전에 먼저 잡아 두면 좋겠다고 느낀 기초 용어로 정리했습니다.

그 글을 쓰면서 특히 헷갈렸던 것은, `Label`과 `Selector`를 이해는 했지만 이것이 실제로 어디에서 어떻게 쓰이는지는 아직 조금 추상적으로 남아 있었다는 점입니다. namespace는 작업 공간이고, pod는 실행 단위이며, label은 리소스의 성격을 설명하고 selector는 그 조건에 맞는 대상을 찾는다는 흐름까지는 잡혔지만, 그다음 단계가 궁금했습니다.

이번 글에서는 바로 그 다음 단계를 이어서 보려고 합니다. `Deployment`와 `Service`를 중심으로, Pod를 어떻게 원하는 개수만큼 유지하는지, 그리고 어떻게 안정적으로 접근하게 만드는지 정리해 보겠습니다. 결국 이번 글의 핵심은 1편에서 본 `Label`과 `Selector`가 실제 Kubernetes 리소스 안에서 어떤 역할을 맡는지 연결해서 이해하는 데 있습니다.

## 01. Selector는 왜 다시 나올까요?

> `Selector`는 혼자 쓰이는 리소스라기보다, 다른 리소스가 label을 기준으로 원하는 Pod를 찾을 때 의미를 가지는 조건입니다.

1편에서 `label`과 `selector`를 따로 떼어 놓고 보면, 솔직히 조금 추상적으로 느껴질 수 있습니다. `label`은 표식이고 `selector`는 조건이라는 설명은 이해가 되지만, 그래서 실제로 Kubernetes 안에서 어디에 쓰이는지는 아직 손에 잘 잡히지 않기 때문입니다.

이번 글에서 보게 될 `Deployment`와 `Service`는 바로 그 지점을 채워 줍니다. 둘 다 직접 Pod 이름을 하나씩 적어 두고 쓰는 방식이 아니라, Pod에 붙어 있는 label을 기준으로 자신이 관리하거나 바라볼 대상을 찾습니다. 즉, 앞에서 배운 selector는 여기서부터 비로소 실제 역할이 선명해집니다.

예를 들어 `app: api`라는 label이 붙은 Pod들이 있다고 가정해 보겠습니다. 그러면 어떤 리소스는 이 label을 가진 Pod를 "내가 유지해야 할 대상"으로 보고, 또 어떤 리소스는 "내가 트래픽을 보내야 할 대상"으로 볼 수 있습니다. 이때 기준으로 쓰이는 것이 selector입니다.

## 02. Deployment란 무엇일까요?

> `Deployment`는 원하는 개수의 Pod를 유지하고, 업데이트를 관리하는 상위 리소스입니다.

Pod는 실행 단위이지만, Pod 자체를 직접 하나씩 운영의 중심에 두기는 어렵습니다. 노드 장애가 생기거나 재스케줄링이 일어나면 기존 Pod는 사라지고 새로운 Pod가 만들어질 수 있기 때문입니다. 즉, Pod는 중요하지만 영구히 고정된 존재라기보다 필요에 따라 교체될 수 있는 실행 단위에 가깝습니다.

운영에서는 보통 "이 Pod 하나를 계속 붙잡고 있어야지"보다는 "`api` 역할을 하는 Pod를 항상 3개 유지하고 싶다"처럼 원하는 상태를 먼저 선언하는 편이 훨씬 자연스럽습니다. `Deployment`는 바로 이 선언을 담당합니다.

예를 들어 아래처럼 `Deployment`를 정의할 수 있습니다.

```yaml
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
```

여기서 핵심은 두 가지입니다. 먼저 `replicas: 3`은 `api` 역할의 Pod를 세 개 유지하겠다는 뜻입니다. 그리고 `selector.matchLabels.app: api`는 "내가 관리할 Pod는 `app: api` label을 가진 Pod다"라는 뜻입니다. 아래의 `template.metadata.labels.app: api`는 실제로 새로 만들어질 Pod에 붙을 label입니다.

즉, `Deployment`는 "어떤 Pod를 몇 개 유지할 것인가"를 선언하는 리소스라고 보면 됩니다. Kubernetes는 그 선언을 기준으로 Pod를 만들고, 부족하면 다시 만들고, 업데이트가 필요하면 교체합니다. 이 덕분에 우리는 개별 Pod보다 한 단계 높은 수준에서 애플리케이션 상태를 관리할 수 있습니다.

## 03. Service란 무엇일까요?

> `Service`는 바뀌는 Pod들 앞에 고정된 접근 지점을 만들어 주는 리소스입니다.

`Deployment`가 Pod의 개수와 상태를 유지해 준다고 해서, 바로 접근 문제까지 해결되는 것은 아닙니다. Pod는 교체될 수 있고, 그 과정에서 IP도 바뀔 수 있습니다. 따라서 특정 Pod의 IP를 직접 바라보고 접근하는 방식은 오래 유지되기 어렵습니다.

이때 필요한 것이 `Service`입니다. `Service`는 여러 Pod 앞에 안정적인 이름과 접근 지점을 하나 만들어 줍니다. 바깥에서는 이 고정된 지점을 바라보고, 내부적으로는 그 뒤에 있는 Pod들이 바뀌더라도 계속 같은 방식으로 접근할 수 있게 해 줍니다.

예를 들어 `app: api` label이 붙은 Pod들로 요청을 보내고 싶다면 `Service`는 아래처럼 selector를 가질 수 있습니다.

```yaml
spec:
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
```

이 설정은 "`app: api` label이 붙은 Pod에게 요청을 보내고, Service의 80번 포트로 들어온 요청은 Pod의 8080 포트로 전달하라"는 의미로 이해할 수 있습니다. 중요한 점은 우리가 더 이상 Pod 하나하나를 직접 바라보지 않는다는 점입니다. 대신 `Service`라는 고정된 창구를 통해, 같은 역할을 하는 Pod 묶음에 접근합니다.

## 04. Deployment와 Service는 어떻게 이어질까요?

지금까지의 내용을 한 줄로 정리하면, `Deployment`는 Pod를 만들어 유지하고, `Service`는 그 Pod들에 안정적으로 접근하게 해 줍니다. 그리고 이 둘을 이어 주는 연결 고리가 바로 `label`과 `selector`입니다.

흐름은 생각보다 단순합니다. `Deployment`는 Pod를 만들 때 `app: api` 같은 label을 붙입니다. 그리고 `Service`는 `app: api` selector를 사용해 그 Pod들을 찾아냅니다. 결국 같은 label 체계를 공유하기 때문에, `Deployment`가 만들어 낸 Pod들을 `Service`가 자연스럽게 바라볼 수 있게 됩니다.

이 관점으로 보면 1편에서 배웠던 `label`과 `selector`가 왜 중요했는지도 더 분명해집니다. label은 Pod의 성격을 설명하는 정보이고, selector는 그 성격을 기준으로 원하는 Pod를 찾는 조건입니다. `Deployment`와 `Service`는 이 공통 규칙 위에서 각각 "유지"와 "접근"이라는 서로 다른 역할을 맡고 있는 셈입니다.

## 갈무리하며

1편에서는 `Namespace`, `Pod`, `Label`, `Selector` 같은 개념을 기초 단위로 나눠서 봤고, 이번 글에서는 그 위에 `Deployment`와 `Service`가 어떻게 올라오는지를 정리해 보았습니다. 제 기준에서는 여기서부터 Kubernetes가 조금 더 "실제로 움직이는 시스템"처럼 느껴지기 시작했습니다.

특히 이번 글을 정리하면서 가장 선명해진 것은, selector가 혼자 존재하는 개념이 아니라는 점이었습니다. `Deployment`와 `Service`가 모두 label을 기준으로 Pod를 바라본다는 점을 이해하고 나니, 앞에서 배운 개념들이 따로 흩어져 있지 않고 하나의 흐름으로 이어진다는 느낌이 들었습니다.

다음 포스팅에서는 `ConfigMap`, `Secret`, `Volume`, `PV`, `PVC`, `HPA`처럼 애플리케이션 운영과 설정 관리에 더 가까운 리소스들을 이어서 정리해 보려고 합니다.

### 관련 공식 문서

- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/)
