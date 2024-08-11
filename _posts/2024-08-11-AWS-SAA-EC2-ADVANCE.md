---
title: AWS SAA - 3. EC2 Advance
description: 탄력적 IP - EC2 배치그룹 - ENI - Hibernate(최대 절전 방식)
author: D15M4S
categories: [자격증, AWS]
tags: [자격증, AWS, AWS-SAA, EC2]
pin: false
image:
  path: https://media.awslagi.com/wp-content/uploads/2021/08/03155356/SAA-C02-1.jpeg
---

## 1. 학습 내용
+ 탄력적 IP (Elastic IP)
+ EC2 배치그룹 (EC2 Placement Group)
  + 분산 배치 그룹 (Spread Placement Group)
  + 클러스터 배치 그룹 (Cluster Placement Group)
  + 파티션 배치 그룹 (Partition Placement Group)
+ 탄력적 네트워크 인터페이스 (Elastic Network Interface)
+ EC2 최대 절전 방식 (EC2 Hibernate)


## 2. 정리

### 1. 탄력적 IP
![ec2-1](assets/img/aws/ec2-advance-1.jpg){: width="972" height="589" }
+ AWS에서 제공하는 고정 IP
+ 최대 5개 제공
+ 신속하게 인스턴스 및 ENI에 할당 가능
+ 탄력적 IP를 사용하게 될 경우 무언가 설계가 잘못되었을 가능성이 높다.
  + DNS와 로드 벨런서를 사용하는 것이 안정성과 유연성을 모두 잡은 현대적인 설계이다.

### 2. EC2 배치그룹
![ec2-2](assets/img/aws/ec2-advance-2.jpg){: width="972" height="589" }
+ 클러스터 배치 그룹
  + 인스턴스를 동일한 가용 영역 내에 가깝게 배치하여 **저지연 네트워크**와 **높은 대역폭**을 제공한다.
+ 분산(Spread) 배치 그룹
  + 하드웨어 장애로부터 **하드웨어 분리**를 통해 인스턴스를 격리하여 **높은 가용성**을 보장한다.
+ 파티션(Partition) 배치 그룹
  + 하드웨어 장애로부터 **파티션 분리**를 통해 인스턴스를 격리하여 **높은 가용성**을 보장한다.

### 3. ENI, EC2 Hibernate
![ec2-3](assets/img/aws/ec2-advance-3.jpg){: width="972" height="589" }
+ ENI (Elastic Network Interface)
  + 컴퓨터의 네트워크 카드와 같다. 인스턴스의 통신을 담당한다.
  + 별도 보안 그룹과 서브넷 설정, 하나의 인스턴스에 여러개 장착이 가능하여 유연한 설계가 가능하다.


+ EC2 Hibernate (EC2 최대 절전 방식)
  + 중지 시 메모리 상태를 EBS에 저장한다. 부팅 시 저장한 데이터를 메모리로 불러온다.
  + OS는 중지되었음을 인지하지 못한다. 이전 상태를 그대로 메모리로 불러왔기 때문
  + EBS의 암호화가 필수적이다. -> 메모리에 있는 값들은 주요한 데이터들이 많다.

## 3. 추가 학습한 내용

+ a. 분산(Spread) 배치 그룹 vs 파티션(Partition) 배치 그룹

+ b. 커스텀 ENI의 장점과 기본 ENI의 한계

+ c. EC2 Hibernate 사용 시 왜 EBS의 암호화가 필수적인가?
