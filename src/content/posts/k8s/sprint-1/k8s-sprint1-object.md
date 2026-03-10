---
title: "쿠버네티스 Warm-up | Namespace, Pod, Label"
published: 2026-03-08
description: "인프런 '쿠버네티스 어나더 클래스 - Sprint 1, 지상편'을 본격적으로 학습하기 전에, Namespace, Pod, Label, Selector처럼 먼저 감을 잡아 두면 좋겠다고 느낀 Kubernetes 기초 용어들을 제 기준으로 정리한 글입니다."
image: "/assets/posts/k8s/k8s-sprint1-object-1_main.jpg"
tags: ["Kubernetes", "Namespace", "Pod", "Label"]
category: "Kubernetes"
draft: false
lang: "ko"
---

회사에서 LLMOps를 구축할 기회가 생겼습니다.

목표는 H200 같은 GPU 자원을 여러 사용자에게 안정적이고 효율적으로 할당할 수 있는 플랫폼을 Kubernetes 위에 만드는 것입니다.

문제는 Kubernetes 경험이 거의 없고, 인프라 기본기도 충분하지 않다는 점이었습니다. 주어진 시간도 넉넉하지 않았기 때문에, 아는 만큼만 감으로 밀어붙여서는 금방 한계에 부딪히겠다는 생각이 들었습니다.

이번에 참고한 강의는 인프런의 [쿠버네티스 어나더 클래스 - Sprint 1, 지상편](https://www.inflearn.com/course/%EC%BF%A0%EB%B2%84%EB%84%A4%ED%8B%B0%EC%8A%A4-%EC%96%B4%EB%82%98%EB%8D%94-%ED%81%B4%EB%9E%98%EC%8A%A4-%EC%A7%80%EC%83%81%ED%8E%B8-sprint1/dashboard?cid=330869)입니다. 다만 `Object 그려보며 이해하기` 파트로 바로 들어가기에는 `Namespace`, `Pod`, `Label`, `Selector` 같은 단어가 아직 제 안에서 충분히 정리되어 있지 않다고 느꼈습니다. 그래서 이번 글에서는 그 개념들을 먼저 짧게 정리해 보는 warm-up을 해 보려고 합니다.

## 01. Namespace란 무엇일까요?

<figure class="my-4">
  <img src="/assets/posts/k8s/k8s-sprint1-object-1_2.png" alt="쿠버네티스 오브젝트 학습 순서를 정리한 강의 자료" />
  <figcaption class="mt-1 text-sm text-black/55 dark:text-white/55">
    이미지 출처: 인프런 <a href="https://www.inflearn.com/course/%EC%BF%A0%EB%B2%84%EB%84%A4%ED%8B%B0%EC%8A%A4-%EC%96%B4%EB%82%98%EB%8D%94-%ED%81%B4%EB%9E%98%EC%8A%A4-%EC%A7%80%EC%83%81%ED%8E%B8-sprint1/dashboard?cid=330869">쿠버네티스 어나더 클래스 - Sprint 1, 지상편</a> 강의자료
  </figcaption>
</figure>

### Resource를 이해하는 것부터 시작해 보겠습니다.

> `Resource`는 Kubernetes API가 식별하고 관리하는 객체입니다. YAML로 선언하고, 생성하고, 조회하고, 수정할 수 있는 대상이 모두 resource입니다.

쿠버네티스를 공부하면서 가장 먼저 눈에 들어온 단어는 `resource`였습니다. 이후에 등장하는 여러 개념들이 결국 Kubernetes가 관리하는 대상이라는 점을 생각하면, 먼저 resource가 무엇을 뜻하는지 이해해야 전체 흐름이 보이겠다고 판단했습니다. 

Kubernetes는 클러스터 안에서 관리하는 대상들을 리소스라는 단위로 다룹니다. 앞으로 보게 될 `Pod`, `Service`, `Deployment`, `ConfigMap`, `Secret`, `PV`, `PVC`, `HPA`도 모두 Kubernetes API를 통해 생성하고 조회하고 수정할 수 있는 리소스입니다.

조금 더 실무적인 관점에서 보면, 리소스는 Kubernetes API를 통해 생성하고 조회하고 수정할 수 있는 관리 대상이라고 볼 수 있습니다. 우리가 YAML 파일에 원하는 상태를 선언하면, Kubernetes는 그 선언을 바탕으로 실제 클러스터 상태를 계속 맞춰 나갑니다.

즉, 이 글에서 말하는 `object`는 막연한 추상 개념이 아니라 Kubernetes가 이해하고 관리하는 리소스라고 생각하시면 훨씬 이해하기 쉽습니다.

### Namespace는 리소스가 속하는 작업 공간입니다.

> `Namespace`는 Kubernetes 리소스가 속하는 논리적인 작업 공간입니다. 같은 클러스터 안에서도 리소스를 구분하고 관리 범위를 나누는 기준이 됩니다.

그렇다면 `namespace`는 무엇일까요? namespace는 Kubernetes 리소스가 소속되는 논리적 구역입니다. 하나의 클러스터를 여러 작업 공간으로 나누는 개념이며, 많은 리소스들은 특정 namespace 안에서 생성되고 관리됩니다. 그래서 같은 이름의 리소스라도 namespace가 다르면 서로 다른 리소스로 존재할 수 있습니다. 또한 namespace는 단순한 구분 표식이 아니라, 조회 범위와 접근 권한, 리소스 제한을 나누는 관리 기준이 됩니다.

예를 들어 하나의 Kubernetes 클러스터 안에 `dev`와 `prod`라는 namespace를 만든다고 가정해 보겠습니다. 이 경우 각 namespace 안에서 같은 이름의 리소스를 따로 운영할 수 있습니다.

- `dev` namespace의 `api` Deployment
- `prod` namespace의 `api` Deployment

이처럼 namespace는 단순한 문자열이 아니라, 리소스의 소속 범위를 나누고 관리 기준을 정하는 경계 역할을 합니다.

## 02. Pod란 무엇일까요?

> `Pod`는 Kubernetes가 생성하고 스케줄링하는 가장 작은 실행 단위입니다. 하나 이상의 container를 묶고, 그 container들이 네트워크와 저장소를 함께 쓰게 만듭니다.

### 먼저, Kubernetes는 container를 직접 다루지 않습니다.

Docker를 자주 사용하다 보니, 저는 자연스럽게 `container`를 하나의 실행 단위로 받아들이고 있었습니다. 그래서 Kubernetes 역시 container를 실행하는 플랫폼이니, 제가 직접 다루는 대상도 결국 container일 것이라고 생각했습니다. 실제로 Kubernetes 안에서도 container는 실행됩니다. 다만 Kubernetes가 container를 다루는 방식은 Docker와 조금 다릅니다. Kubernetes는 개별 container를 직접 배치하는 대신, container를 담고 있는 `Pod`를 최소 관리 단위로 삼습니다.

이 차이는 생각보다 중요합니다. Pod는 단순히 container를 감싸는 껍데기가 아니라, container가 실행될 환경까지 함께 정의하는 단위이기 때문입니다. 네트워크, volume, 재시작 정책 같은 정보도 Pod 단위에서 붙습니다.

또한 Pod는 namespace에 속하는 리소스입니다. 따라서 어떤 Pod가 어느 namespace에 속하는지에 따라 조회 범위와 관리 범위도 함께 달라집니다.

### Pod 안에는 보통 하나의 container가 들어갑니다.

기술적으로는 하나의 Pod 안에 여러 container를 넣을 수 있습니다. 하지만 처음 학습할 때는 "Pod 하나에 메인 container 하나가 들어간다"라고 이해하셔도 거의 맞습니다.

저도 이 지점이 궁금했습니다. 실무에서 하나의 Pod 안에 실제로 container가 몇 개나 들어가는지 감이 잘 오지 않았기 때문입니다. 예전에 Langfuse를 Docker 환경에 세팅할 때는 여러 container를 띄우고, 각각에 `langfuse`라는 접두사를 붙여 관리한 경험이 있었습니다. 그래서 처음에는 이런 container들이 Kubernetes에 오면 하나의 Pod 안에 모두 들어가서 하나의 애플리케이션으로 구성되는 줄 알았습니다.

하지만 실제로는 조금 다릅니다. **하나의 서비스나 제품이 여러 container로 이루어져 있다고 해서, 그것들이 반드시 하나의 Pod 안에 들어가는 것은 아닙니다.** Kubernetes에서는 하나의 제품이더라도 역할에 따라 여러 Pod로 나누어 배포하는 경우가 많습니다. 예를 들어 API 서버, worker, database, cache처럼 서로 역할이 다르고 독립적으로 확장되거나 교체되어야 하는 요소들은 보통 각각 다른 Pod로 분리됩니다.

반대로 하나의 Pod 안에 여러 container를 두는 경우는, 서로 아주 강하게 결합되어 함께 움직여야 할 때가 많습니다. 로그 수집, 프록시, 인증 보조 처리처럼 메인 container 옆에서 같은 네트워크와 volume을 공유하며 거의 한 몸처럼 동작해야 하는 경우가 대표적입니다. 이런 구성을 흔히 `sidecar 패턴`이라고 부릅니다.

### 여기서 Sidecar 패턴이란 무엇일까요?

위에서 `sidecar 패턴`에 대해 이야기가 나와서, 조금 더 구체적으로 정리해 보겠습니다.

sidecar 패턴은 메인 애플리케이션 container 옆에 보조 역할의 container를 함께 붙여 두는 방식입니다. 이름 그대로 메인 container 옆에 붙어 다니는 보조 수단 같은 느낌으로 이해하시면 됩니다. 메인 container가 실제 비즈니스 로직을 담당하고, sidecar container는 로그 수집, 트래픽 프록시, 인증 보조, 설정 동기화 같은 주변 기능을 맡습니다.

중요한 점은 sidecar가 단순히 옆에 있는 보조 container가 아니라, 메인 container와 같은 생명주기로 움직인다는 점입니다. 함께 생성되고, 함께 종료되며, 같은 Pod 안에서 네트워크와 volume을 공유합니다. 그래서 sidecar는 별도의 Pod로 떼어 두는 것보다, 메인 container 옆에 붙여 두는 편이 더 자연스러운 경우가 많습니다.

예를 들어 메인 애플리케이션이 남기는 로그를 바로 수집해야 하거나, 모든 요청을 프록시를 거쳐 보내야 하거나, 동일한 파일을 함께 읽고 써야 한다면 sidecar 구성이 잘 맞습니다. 반대로 독립적으로 확장되어야 하거나, 서로 다른 생명주기를 가져야 하는 요소라면 sidecar보다는 별도의 Pod로 분리하는 편이 더 적절합니다.

실무적으로는 아래와 같은 경우 sidecar 구성을 고려할 수 있습니다.

- 메인 container와 **반드시 함께 시작되고 함께 종료되어야 할 때**
- 같은 Pod 안에서 **네트워크를 직접 공유해야 할 때**
- 같은 파일이나 설정을 **동일한 volume으로 함께 읽고 써야 할 때**
- 보조 기능이지만, 메인 애플리케이션과 **항상 붙어 다녀야 의미가 있을 때**
- 별도로 분리하면 오히려 운영 복잡도가 높아지고, **독립 확장의 이점이 거의 없을 때**

즉, "하나의 애플리케이션 = 하나의 Pod"라고 단순하게 생각하면 실제 구조를 오해하기 쉽습니다. **Pod는 하나의 서비스 전체를 담는 상자라기보다, 함께 실행되어야 하는 container들을 묶는 단위**라고 이해하시는 편이 더 정확합니다. 하나의 서비스 전체는 여러 Pod의 조합으로 구성될 수 있습니다.

### 같은 Pod 안의 container들은 무엇을 공유할까요?

같은 Pod 안의 container들은 단순히 한곳에 모여 있는 것이 아닙니다. Kubernetes는 이 container들을 하나의 실행 단위로 보고, 꼭 함께 써야 하는 자원을 Pod 수준에서 묶어 둡니다. 핵심은 **네트워크와 저장소를 Pod 단위로 공유한다**는 점입니다.

먼저 네트워크부터 보겠습니다. 같은 Pod 안의 container들은 각자 IP를 하나씩 받지 않습니다. 대신 Pod 전체가 IP 하나를 가지고, 그 안의 container들이 같은 네트워크 공간을 함께 씁니다. 그래서 한 container가 `127.0.0.1:8080`에서 요청을 받고 있으면, 같은 Pod 안의 다른 container도 `localhost:8080`으로 바로 접근할 수 있습니다.

이 부분은 Docker를 써 본 사람에게는 조금 헷갈릴 수 있습니다. Docker에서도 여러 container를 같은 network에 연결할 수 있기 때문입니다. 하지만 그 경우에는 보통 container마다 자기 IP가 따로 있고, `localhost`도 자기 자신만 가리킵니다. 즉 Docker에서 "같은 network를 쓴다"는 것은 서로 통신할 수 있다는 뜻에 가깝고, Kubernetes에서 "같은 Pod에 있다"는 것은 아예 같은 네트워크 공간을 함께 쓴다는 뜻에 더 가깝습니다. 그래서 같은 Pod 안의 두 container는 같은 port를 동시에 사용할 수 없습니다.

저장소도 비슷하게 이해하면 됩니다. 같은 Pod에 있다고 해서 파일 시스템 전체가 하나로 합쳐지는 것은 아닙니다. 다만 Pod에 volume을 정의하고 여러 container에 mount하면, 같은 파일을 함께 읽고 쓸 수 있습니다. sidecar container가 메인 container의 로그를 읽거나, 여러 container가 같은 설정 파일을 참조하는 구성이 자연스러운 이유가 여기에 있습니다.

물론 모든 것이 공유되는 것은 아닙니다. container image, 루트 파일 시스템, 환경 변수는 기본적으로 container마다 따로 가집니다. 그래서 Pod는 여러 container를 무조건 하나로 합치는 개념이라기보다, **함께 움직여야 하는 container들이 공통의 네트워크와 저장소를 나눠 쓰도록 묶어 주는 실행 단위**라고 이해하는 편이 더 자연스럽습니다.

## Labels & Selector

> `Label`은 Kubernetes 리소스에 붙이는 key-value 형태의 분류 정보이고, `Selector`는 그 label을 기준으로 원하는 리소스를 고르는 조건입니다.

### Label은 리소스에 붙이는 표식입니다.

Kubernetes에서는 리소스가 많아질수록 이름만으로 대상을 관리하기가 불편해집니다. 이름은 보통 하나의 리소스를 식별하는 데 쓰이지만, 실제 운영에서는 "이 Pod는 어떤 애플리케이션에 속하는가", "운영 환경인가 개발 환경인가", "frontend인가 backend인가" 같은 분류 정보가 더 자주 필요합니다. 이럴 때 붙이는 것이 `label`입니다.

예를 들어 Pod 하나에 아래와 같은 label을 붙일 수 있습니다.

```yaml
metadata:
  labels:
    app: api
    env: prod
    tier: backend
```

이렇게 해 두면 이 Pod는 `api` 애플리케이션에 속하고, `prod` 환경에서 돌고 있으며, 역할은 `backend`라고 표현할 수 있습니다. 중요한 점은 label이 하나만 붙는 것이 아니라, **하나의 리소스에 여러 label을 조합해서 붙일 수 있다**는 점입니다. 그래서 label은 단순한 이름표라기보다, 리소스를 여러 관점에서 설명하는 메타데이터에 가깝습니다.

### Selector는 label을 기준으로 대상을 고르는 조건입니다.

label이 리소스에 붙이는 정보라면, `selector`는 그 정보를 바탕으로 원하는 대상을 골라내는 조건입니다. 쉽게 말해 label이 "붙이는 것"이라면, selector는 "찾는 것"에 가깝습니다. 중요한 점은 selector가 Pod에 무언가를 새로 붙이는 것이 아니라, **이미 붙어 있는 label을 기준으로 조건에 맞는 Pod를 골라낸다**는 데 있습니다.

예를 들어 Pod가 세 개 있다고 가정해 보겠습니다. 하나는 `app=api, env=prod`, 다른 하나는 `app=api, env=dev`, 마지막 하나는 `app=web, env=prod` label을 가지고 있다고 해 보겠습니다. 이때 `app=api`라는 selector를 사용하면, 세 Pod 중에서 앞의 두 Pod를 골라낼 수 있습니다.

```yaml
selector:
  app: api
```

위 selector는 `app: api` label을 가진 Pod를 찾는 조건입니다. 여기에 `env=prod` 조건까지 함께 붙이면, 이번에는 첫 번째 Pod 하나만 남습니다. 즉, 조건이 여러 개일 때는 보통 **모든 조건을 동시에 만족하는 리소스만 남게 됩니다.**

왜 굳이 이런 방식이 필요할까요? Pod 이름은 하나의 대상을 정확히 구분할 때는 유용하지만, 같은 성격을 가진 Pod들을 한 번에 묶어 보기에는 불편합니다. 반면 label을 붙여 두면 `api` 역할을 하는 Pod, `prod` 환경의 Pod처럼 조건으로 대상을 찾을 수 있습니다. 그래서 label은 "이 Pod가 어떤 성격을 가졌는가"를 설명하고, selector는 "그중에서 어떤 Pod를 찾을 것인가"를 정하는 기준이라고 이해하면 됩니다.

정리하면, label은 분류를 위한 정보이고 selector는 그 분류 정보를 이용해 대상을 찾는 조건입니다. label만 붙어 있다고 해서 자동으로 무언가가 일어나는 것은 아니고, selector만 있어도 맞는 label이 없으면 찾을 수 있는 대상이 없습니다. Kubernetes는 이런 방식으로 여러 Pod 중에서 필요한 대상을 골라냅니다.

## 갈무리하며

이 글은 강의를 본격적으로 보기 전에, 자꾸 걸리던 단어들을 제 기준으로 먼저 정리해 본 기록입니다. `Namespace`, `Pod`, `Label`, `Selector`를 미리 분리해서 적어 보니, 뒤에서 나올 내용도 조금 덜 추상적으로 받아들일 수 있을 것 같았습니다.

지금 제 기준에서는 namespace는 소속을 나누는 작업 공간이고, pod는 실제로 container가 실행되는 단위이며, label은 리소스의 성격을 설명하는 정보이고, selector는 그 조건에 맞는 대상을 찾는 기준입니다. 최소한 이 정도 감을 먼저 잡아 두면, 이후 Sprint 1에서 다루는 object들도 훨씬 덜 낯설게 느껴질 것 같습니다.

다음 글에서는 [쿠버네티스 Warm-up 2 | Deployment, Service, HPA](/posts/k8s/sprint-1/k8s-warmup-part-2/)로 이어서, Pod를 실제 운영 가능한 서비스 단위로 끌어올릴 때 필요한 리소스들을 정리해 보려고 합니다. 그다음 글에서는 [쿠버네티스 Warm-up 3 | ConfigMap, Secret, PV, PVC](/posts/k8s/sprint-1/k8s-warmup-part-3/)를 통해 설정, 비밀값, 저장소까지 이어서 정리해 보겠습니다.

### 관련 공식 문서

- [Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)
