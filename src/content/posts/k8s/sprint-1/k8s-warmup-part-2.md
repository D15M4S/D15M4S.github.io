---
title: "쿠버네티스 Warm-up 2 | Deployment, Service, HPA"
published: 2026-03-09
description: "1부에서 본 Namespace, Pod, Label, Selector 위에 Deployment, Service, HPA가 어떻게 올라오는지, Pod를 유지하고 연결하고 자동으로 늘리는 흐름을 제 기준으로 정리한 글입니다."
image: "/assets/posts/k8s/k8s-sprint1-object-1_main.jpg"
tags: ["Kubernetes", "Deployment", "Service", "HPA"]
category: "Kubernetes"
draft: false
lang: "ko"
---

이번 글은 [쿠버네티스 Warm-up | Namespace, Pod, Label](/posts/k8s/sprint-1/k8s-sprint1-object/)에 이어, Deployment, Service, HPA를 정리해 본 글입니다.

### 들어가며

Kubernetes에서는 특정 Pod 하나가 계속 유지된다고 생각하면 안 됩니다. Pod가 올라가 있던 노드(Pod가 실행되는 서버)에 장애가 나거나, 배포 중 교체가 일어나면 기존 Pod는 사라지고 같은 역할의 새 Pod가 다시 만들어질 수 있기 때문입니다.

그래서 Kubernetes는 특정 Pod 하나를 그대로 유지하는 것을 목표로 하지 않습니다. 대신 같은 역할의 Pod가 정해진 개수만큼 유지되도록 관리합니다. 어떤 Pod가 사라지면 새로 만들고, 필요 이상으로 많아지면 줄입니다.

따라서 Kubernetes에서는 다음 세 가지를 고려해야 합니다.

- 같은 역할의 Pod를 원하는 개수만큼 유지하는 것
- Pod가 바뀌어도 같은 방식(같은 주소나 이름)으로 접근할 수 있게 만드는 것
- 부하에 따라 Pod 수를 자동으로 조절하는 것

이 세 가지를 각각 담당하는 리소스는 `Deployment`, `Service`, `HPA`입니다.

## 01. Deployment란 무엇일까요?

> Deployment는 원하는 개수의 Pod를 유지하고, 업데이트를 관리하는 상위 리소스입니다.

### Deployment는 Pod의 개수를 유지합니다

Deployment는 같은 역할의 Pod를 몇 개 유지할지 정해 두는 리소스입니다. 예를 들어 API 서버 Pod를 항상 3개 두고 싶다면, 그 기준을 Deployment에 적어 둘 수 있습니다. 그러면 Kubernetes는 실제 Pod 수가 부족해졌을 때 새로 만들고, 배포 내용이 바뀌면 그 기준에 맞게 Pod를 교체합니다.

Deployment를 볼 때는 `selector`와 `template`을 같이 보는 편이 중요합니다. selector는 내가 관리할 Pod를 찾는 조건이고, 이 조건은 Pod에 붙은 label을 기준으로 동작합니다.

template라는 말은 조금 생소하실 수 있습니다. 정확히 말하면 Pod template이고, Deployment가 새 Pod를 만들어야 할 때 참고하는 설계도라고 생각하면 됩니다. 여기에는 Pod에 어떤 label을 붙일지, 어떤 container image로 실행할지, 어떤 port를 열지 같은 정보가 들어갑니다. 상황에 따라서는 환경 변수, volume, 재시작 정책 같은 설정도 함께 들어갈 수 있습니다.

실제로 `spec.template` 아래의 구조는 Pod를 정의할 때 쓰는 `metadata`와 `spec`을 거의 그대로 담고 있습니다. 쉽게 말하면 selector는 "어떤 Pod를 내가 관리할 것인가"를 정하고, template은 "새 Pod를 어떤 모양으로 만들 것인가"를 정한다고 이해하면 됩니다.

예를 들어 아래처럼 Deployment를 정의할 수 있습니다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: my-api:1.0
          ports:
            - containerPort: 8080
```

### YAML에서는 이 세 가지를 먼저 보면 됩니다

여기서 핵심은 세 가지입니다.

- `replicas: 3`은 `api` Pod를 항상 3개 유지하겠다는 뜻입니다.
- `selector.matchLabels.app: api`는 내가 관리할 Pod의 기준을 정합니다.
- `template.metadata.labels.app: api`는 새로 만들어질 Pod에 붙을 label입니다.

이 구조를 보면 Deployment는 단순히 Pod를 복제하는 도구가 아닙니다. 몇 개의 Pod를 유지할지, 어떤 Pod를 내가 관리할지, 새 Pod는 어떤 모양으로 만들지를 한 번에 정하는 리소스입니다. Pod 하나가 사라지면 다시 만들고, 이미지가 바뀌면 새 기준에 맞춰 교체하는 출발점도 여기입니다.

### Deployment는 ReplicaSet을 통해 동작합니다

조금 더 정확히 말하면, Deployment는 내부적으로 `ReplicaSet`을 통해 Pod 개수를 맞춥니다. 다만 warm-up 단계에서는 "Deployment가 원하는 수의 Pod를 유지해 주는 상위 리소스" 정도로 잡아 두셔도 충분합니다.

## 02. Service란 무엇일까요?

> Service는 바뀌는 Pod들 앞에 고정된 접근 지점을 만들어 주는 리소스입니다.

Deployment가 Pod를 잘 유지해 준다고 해서, 곧바로 접근 문제가 해결되는 것은 아닙니다. Pod는 교체될 수 있고, 그 과정에서 IP도 바뀔 수 있기 때문입니다. 따라서 특정 Pod의 IP를 직접 보고 접근하는 방식은 오래 유지되기 어렵습니다.

이때 필요한 것이 Service입니다. Service는 여러 Pod 앞에 안정적인 이름과 네트워크 지점을 하나 만들어 줍니다. 다른 리소스들은 이 고정된 창구를 바라보고, 내부적으로는 그 뒤에 있는 Pod들이 바뀌더라도 계속 같은 방식으로 접근할 수 있게 됩니다.

예를 들어 `app: api` label이 붙은 Pod들로 요청을 보내고 싶다면 Service는 아래처럼 selector를 가질 수 있습니다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
```

이 설정은 "`app: api` label이 붙은 Pod에게 요청을 보내고, Service의 80번 포트로 들어온 요청은 Pod의 8080 포트로 전달하라"는 의미로 이해할 수 있습니다.

중요한 점은 Service가 Pod를 "만들거나 유지"하지는 않는다는 것입니다. 그 역할은 Deployment 쪽에 있습니다. Service는 이미 존재하는 Pod들 중에서 selector에 맞는 대상을 찾아, 그 앞에 고정된 접근 지점을 세워 주는 쪽에 가깝습니다.

즉, Deployment가 "유지"를 담당한다면, Service는 "연결"을 담당한다고 생각하면 구조가 훨씬 선명해집니다.

## 03. HPA란 무엇일까요?

> HPA는 메트릭을 기준으로 Pod 수를 자동으로 조절하는 리소스입니다.

Deployment에 `replicas: 3`을 적어 두면 당장은 세 개를 유지할 수 있습니다. 하지만 실제 트래픽은 고정되어 있지 않습니다. 어떤 시간대에는 요청이 몰리고, 어떤 시간대에는 거의 한산할 수 있습니다. 이런 상황에서 항상 같은 수의 Pod만 유지하면 비효율적일 수 있습니다.

이때 등장하는 것이 `HPA(HorizontalPodAutoscaler)`입니다. 이름 그대로 Pod를 "가로로", 즉 개수를 늘리거나 줄이는 방식으로 자동 확장하는 리소스입니다.

예를 들면 아래처럼 정의할 수 있습니다.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

이 설정은 CPU 사용률이 평균 70%를 넘는 방향으로 가면 `api` Deployment의 replica 수를 늘리고, 반대로 낮아지면 범위 안에서 줄이겠다는 뜻입니다.

여기서 중요한 포인트는 HPA가 "Pod 하나를 직접 확장"하는 것이 아니라, Deployment 같은 확장 가능한 리소스의 replica 수를 조절한다는 점입니다. 즉, HPA는 Deployment 위에서 동작합니다.

또 하나 기억해 둘 것은, HPA가 마법처럼 혼자 작동하지는 않는다는 점입니다. CPU나 메모리 같은 메트릭을 보려면 클러스터에 그 메트릭을 수집하고 제공하는 경로가 있어야 합니다. 실습 환경에서는 보통 `metrics-server` 같은 구성까지 함께 확인하게 됩니다.

## 04. Deployment, Service, HPA는 어떻게 이어질까요?

지금까지의 내용을 한 흐름으로 묶으면 아래와 같습니다.

- Deployment는 `app: api` label이 붙은 Pod를 원하는 개수만큼 유지합니다.
- Service는 같은 label을 selector로 사용해 그 Pod들에게 요청을 보냅니다.
- HPA는 메트릭을 보고 Deployment의 replica 수를 조절합니다.
- Pod 수가 늘어나거나 줄어도 Service는 같은 label을 기준으로 계속 대상을 찾습니다.

이 구조가 중요한 이유는, 세 리소스가 모두 "개별 Pod 이름"이 아니라 **label과 원하는 상태**를 기준으로 움직이기 때문입니다.

예를 들어 트래픽이 몰려서 HPA가 `api` Deployment를 3개에서 6개로 늘렸다고 가정해 보겠습니다. 그러면 새로 만들어진 Pod들에도 같은 `app: api` label이 붙습니다. Service는 별도 수정 없이 그 새 Pod들까지 자동으로 바라보게 됩니다. 즉, 확장과 연결이 같은 label 체계 위에서 자연스럽게 이어집니다.

제 기준에서는 여기서부터 Kubernetes가 조금 더 "실제로 운영되는 시스템"처럼 보이기 시작했습니다. 1부에서는 Pod, Label, Selector가 조금은 추상적인 단어로 보였다면, 이번 글에서는 그것들이 왜 필요한지 역할이 훨씬 선명해졌습니다.

## 갈무리하며

이번 글에서는 Deployment, Service, HPA를 따로 떼어 보면서, Pod를 실제 운영 가능한 서비스 단위로 끌어올릴 때 어떤 리소스들이 필요한지 정리해 보았습니다.

지금 제 기준에서는 Deployment는 원하는 상태를 유지하는 리소스이고, Service는 그 Pod들에 안정적으로 접근하게 해 주는 리소스이며, HPA는 부하에 따라 그 수를 자동으로 조절하는 리소스입니다. 이 정도 감을 먼저 잡아 두면, Sprint 1에서 나오는 object 흐름도 훨씬 덜 갑작스럽게 느껴질 것 같습니다.

다음 글에서는 [쿠버네티스 Warm-up 3 | ConfigMap, Secret, PV, PVC](/posts/k8s/sprint-1/k8s-warmup-part-3/)로 이어서, 애플리케이션이 실제 실행될 때 필요한 설정, 비밀값, 저장소를 어떻게 붙이는지 정리해 보려고 합니다.

### 관련 공식 문서

- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
