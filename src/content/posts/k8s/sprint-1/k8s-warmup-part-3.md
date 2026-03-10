---
title: "쿠버네티스 Warm-up 3 | ConfigMap, Secret, PV, PVC"
published: 2026-03-10
description: "2부에서 Deployment, Service, HPA로 Pod를 운영하는 흐름을 본 뒤, ConfigMap, Secret, PV, PVC가 설정과 비밀값, 저장소를 어떻게 붙이는지 제 기준으로 정리한 글입니다."
image: "/assets/posts/k8s/k8s-sprint1-object-1_main.jpg"
tags: ["Kubernetes", "ConfigMap", "Secret", "PV", "PVC"]
category: "Kubernetes"
draft: false
lang: "ko"
---

이번 글은 [쿠버네티스 Warm-up 2 | Deployment, Service, HPA](/posts/k8s/sprint-1/k8s-warmup-part-2/)에 이어, `ConfigMap`, `Secret`, `PV`, `PVC`를 warm-up 관점에서 먼저 정리해 보는 글입니다.

2부에서 `Deployment`, `Service`, `HPA`를 보면서, Pod를 어떻게 유지하고 연결하고 늘릴지를 먼저 정리했습니다. 그런데 그 흐름만으로는 아직 실제 애플리케이션이 완성되지는 않습니다.

애플리케이션은 보통 설정값이 필요하고, 비밀번호나 API 키 같은 민감한 정보도 필요하며, 경우에 따라서는 Pod가 다시 떠도 살아남아야 하는 데이터도 필요합니다. 이번 글에서는 바로 그 세 가지를 담당하는 리소스들을 제 기준으로 이어서 정리해 보겠습니다.

## 01. 운영 리소스만으로는 왜 부족할까요?

> container image 하나만 잘 만든다고 해서, 애플리케이션이 곧바로 운영 가능한 상태가 되는 것은 아닙니다.

예를 들어 같은 애플리케이션 이미지라도 `dev`와 `prod` 환경에서 서로 다른 설정값을 써야 할 수 있습니다. 외부 API 주소가 다를 수도 있고, 로그 레벨이 다를 수도 있고, 기능 플래그가 다를 수도 있습니다. 이런 값들까지 전부 image 안에 고정해 두면 운영이 금방 불편해집니다.

민감한 정보는 더 조심해야 합니다. 데이터베이스 비밀번호, 토큰, API 키 같은 값을 소스 코드나 image에 그대로 넣어 두는 방식은 관리도 어렵고, 노출 위험도 큽니다.

또 하나는 저장소입니다. Pod는 다시 만들어질 수 있는 실행 단위이기 때문에, Pod의 생명주기와 함께 사라지면 안 되는 데이터가 있다면 별도의 저장소 개념이 필요합니다.

즉, 실제 운영에서는 아래 세 가지를 분리해서 생각하게 됩니다.

- 일반 설정값은 어떻게 외부에서 주입할 것인가
- 민감한 값은 어떻게 분리해서 관리할 것인가
- 데이터는 Pod와 분리해서 어떻게 보존할 것인가

이 질문에 각각 대응하는 리소스가 `ConfigMap`, `Secret`, `PV`, `PVC`입니다.

## 02. ConfigMap이란 무엇일까요?

> `ConfigMap`은 민감하지 않은 설정값을 container image와 분리해, 리소스 형태로 관리하는 방법입니다.

`ConfigMap`은 애플리케이션이 필요로 하는 일반 설정값을 담는 리소스입니다. 예를 들면 실행 모드, 로그 레벨, 외부 서비스 주소, 기능 토글 같은 값들을 여기에 넣을 수 있습니다.

예를 들어 아래처럼 정의할 수 있습니다.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  APP_ENV: prod
  LOG_LEVEL: info
  API_TIMEOUT: "30"
```

이렇게 만들어 둔 `ConfigMap`은 Pod 안으로 여러 방식으로 넣을 수 있습니다. 환경 변수로 주입할 수도 있고, 파일 형태로 mount할 수도 있습니다. 중요한 점은 설정을 image 안에 굳이 박아 넣지 않고, 실행 환경에 맞게 바깥에서 붙일 수 있다는 것입니다.

이 방식이 유용한 이유는 같은 image를 여러 환경에서 재사용하기 쉬워지기 때문입니다. 예를 들어 개발 환경과 운영 환경이 서로 다른 API endpoint를 써야 하더라도, image를 다시 만들기보다 `ConfigMap`만 다르게 두는 편이 훨씬 자연스럽습니다.

물론 이름에서 알 수 있듯이, `ConfigMap`은 어디까지나 **민감하지 않은 설정**에 쓰는 쪽이 맞습니다. 비밀번호나 토큰 같은 값까지 여기에 넣으면 곤란합니다.

## 03. Secret이란 무엇일까요?

> `Secret`은 비밀번호, 토큰, 인증서처럼 민감한 값을 분리해 다루기 위한 리소스입니다.

`Secret`은 사용하는 방식만 보면 `ConfigMap`과 꽤 비슷합니다. Pod 안으로 환경 변수로 넣을 수도 있고, 파일처럼 mount할 수도 있습니다. 차이는 담고 있는 내용이 민감하다는 점입니다.

예를 들어 아래처럼 정의할 수 있습니다.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-secret
type: Opaque
stringData:
  DB_PASSWORD: super-secret
  API_KEY: example-key
```

이렇게 두면 애플리케이션은 필요한 시점에 `Secret`을 참조해서 비밀번호나 토큰을 받을 수 있습니다. 적어도 소스 코드나 container image 안에 직접 비밀값을 넣어 두는 것보다는 훨씬 낫습니다.

다만 여기서 한 가지는 분명히 알고 가는 편이 좋습니다. Kubernetes `Secret`은 "아무렇게나 넣어도 완벽하게 안전한 금고"를 뜻하지는 않습니다. 기본적으로 값이 base64로 표현되기 때문에, 이것만으로 암호화가 된다고 생각하면 오해가 생길 수 있습니다.

실제 보안 수준은 etcd 암호화 설정, RBAC, 클러스터 접근 통제, 외부 비밀 관리 시스템 연동 같은 운영 방식까지 함께 봐야 합니다. warm-up 단계에서는 우선 "민감한 값은 ConfigMap이 아니라 Secret으로 분리한다"는 원칙부터 잡아 두는 것이 좋겠습니다.

## 04. PV와 PVC는 왜 같이 봐야 할까요?

> `PV`는 실제 저장소 자원이고, `PVC`는 애플리케이션이 그 저장소를 요청하는 방식입니다.

2부에서 `Deployment`를 보며 Pod가 언제든 교체될 수 있다는 점을 확인했습니다. 이 말은 곧, Pod 내부에만 남아 있는 데이터는 Pod와 함께 사라질 수 있다는 뜻이기도 합니다.

물론 모든 애플리케이션이 영속 저장소를 필요로 하는 것은 아닙니다. 완전히 stateless한 API 서버라면 매번 새 Pod가 떠도 큰 문제가 없을 수 있습니다. 하지만 업로드 파일, 캐시가 아닌 실제 데이터, 사용자 생성 결과물처럼 유지되어야 하는 값이 있다면 이야기가 달라집니다.

이때 나오는 개념이 `PersistentVolume(PV)`와 `PersistentVolumeClaim(PVC)`입니다.

- `PV`는 클러스터가 제공하는 저장소 자원입니다.
- `PVC`는 애플리케이션이 "이 정도 크기와 방식의 저장소가 필요하다"라고 요청하는 선언입니다.

실무에서는 보통 애플리케이션이 PV를 직접 붙잡기보다 PVC를 먼저 만들고, 그 PVC를 Pod에서 참조하는 흐름으로 이해하면 편합니다. 많은 환경에서는 `StorageClass`를 통해 PVC 요청에 맞는 PV가 동적으로 준비되기도 합니다.

예를 들어 PVC는 아래처럼 작성할 수 있습니다.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: api-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

이 선언은 "나는 `ReadWriteOnce` 방식으로 10Gi 크기의 저장소가 필요하다"는 요청에 가깝습니다. 그리고 Pod는 이 PVC를 volume으로 mount해서 사용합니다.

중요한 점은 저장소의 생명주기를 Pod와 분리한다는 데 있습니다. Pod가 사라졌다가 다시 떠도 같은 PVC를 다시 붙일 수 있다면, 데이터도 함께 이어질 수 있습니다. 다만 실제로 PV가 언제까지 남는지는 storage class나 reclaim policy 설정에 따라 달라질 수 있으므로, "영속 저장소"라는 말만 믿고 항상 자동 보존된다고 생각하면 안 됩니다.

## 05. 결국 이것들도 Pod에 붙습니다.

지금까지 `ConfigMap`, `Secret`, `PVC`를 따로 봤지만, 실제로는 이 리소스들도 결국 Pod를 통해 사용됩니다. 조금 더 정확히 말하면, `Deployment`의 Pod template 안에서 연결되는 경우가 많습니다.

예를 들어 아래처럼 한 번에 엮을 수 있습니다.

```yaml
spec:
  template:
    spec:
      containers:
        - name: api
          image: my-api:1.0
          envFrom:
            - configMapRef:
                name: api-config
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: api-secret
                  key: DB_PASSWORD
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: api-data
```

이 흐름을 보면 구조가 꽤 명확해집니다.

- `Deployment`는 어떤 Pod를 띄울지 정합니다.
- `ConfigMap`은 그 Pod에 일반 설정을 넣어 줍니다.
- `Secret`은 민감한 값을 넣어 줍니다.
- `PVC`는 Pod가 붙잡을 저장소를 연결해 줍니다.

즉, 2부에서 본 운영 리소스들과 3부에서 본 설정/저장소 리소스들은 서로 따로 노는 것이 아닙니다. 결국 하나의 Pod template 안에서 만나서 실제 애플리케이션 실행 환경을 구성합니다.

제 기준에서는 이 지점까지 와야 Kubernetes object들이 조금 덜 흩어져 보였습니다. 앞에서는 이름만 따로 외우기 쉬웠는데, 이제는 "유지하는 리소스", "연결하는 리소스", "설정을 넣는 리소스", "저장소를 붙이는 리소스"처럼 역할별로 나눠 이해할 수 있게 됐습니다.

## 갈무리하며

이번 글에서는 `ConfigMap`, `Secret`, `PV`, `PVC`를 따로 떼어 보면서, 애플리케이션이 실제로 실행될 때 필요한 설정, 비밀값, 저장소가 어떻게 Pod에 연결되는지 정리해 보았습니다.

1부에서는 `Namespace`, `Pod`, `Label`, `Selector`를 먼저 잡았고, 2부에서는 `Deployment`, `Service`, `HPA`를 통해 운영 흐름을 보았습니다. 그리고 이번 3부에서는 그 위에 설정과 저장소가 어떻게 올라오는지를 이어서 봤습니다. 제 기준에서는 이 세 단계까지만 정리해도 Sprint 1에서 나오는 object 흐름이 훨씬 덜 낯설게 느껴집니다.

이제는 "Pod가 실행 단위다"라는 말에서 한 걸음 더 나아가, "그 Pod를 누가 유지하고, 누가 연결하고, 무엇이 설정을 넣고, 어떤 방식으로 저장소를 붙이는가"까지 한 흐름으로 보이기 시작했습니다. warm-up의 목적도 바로 거기까지 감을 먼저 잡아 두는 데 있었다고 생각합니다.

### 관련 공식 문서

- [ConfigMap](https://kubernetes.io/docs/concepts/configuration/configmap/)
- [Secret](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
