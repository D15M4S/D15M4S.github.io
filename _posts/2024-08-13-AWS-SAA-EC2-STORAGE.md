---
title: AWS SAA - 4. EC2 Instance Storage
description: EBS- AMI - EFS
author: D15M4S
categories: [자격증, AWS]
tags: [자격증, AWS, AWS-SAA, EC2]
pin: false
image:
  path: https://media.awslagi.com/wp-content/uploads/2021/08/03155356/SAA-C02-1.jpeg
---


## 1. 학습 내용
+ Amazon EBS Volume (Elastic Block Store)
  + EBS Volume Type (Storage Class)
  + EBS Snapshot
  + EBS Multi-Attach (다중 연결)
  + EBS Encryption (암호화)
+ AMI (Amazon Machine Image)
+ Amazon EFS (Elastic File System)
  + EFS Performance mode
  + EFS ThroughPut mode
  + EFS Storage Class
  + EFS LifeCycle Policy(수명 주기 관리)
  + File System Type


## 2. 정리

### 1. EBS (Elastic Block Store)
![ec2-1](assets/img/aws/ec2-storage-1.jpg){: width="972" height="589" }
+ 컴퓨터의 SSD, HDD와 같은 역할
+ 물리 드라이브 X, 가상 네트워크 드라이브 O 따라서 지연이 있을 수 있다.
+ 하나의 가용영역(AZ)에 제한된다
+ gp/2는 크기 비례, gp/3는 사용자 설정 가능
+ io/1, io/2는 PIOPS, io/2 기준 최대 256,000 iops


### 2. EBS Snapshot & AMI
![ec2-2](assets/img/aws/ec2-storage-2.jpg){: width="972" height="589" }
+ EBS Snapshot
  + EBS의 특정 시점을 캡처하는 것
  + 캡처한 Snapshot을 다른 AZ로 옮길 수 있다.
+ AMI
  + EC2의 특정 시점을 캡처하는 것
  + 캡처한 AMI를 통해 다른 인스턴스를 생성할 수 있다.
  + AMI 자체는 리전에 종속. 타 리전에 복사 후 붙여넣기 가능

### 3. EBS Multi-Attach & EBS Encryption
![ec2-3](assets/img/aws/ec2-storage-3.jpg){: width="972" height="589" }
+ EBS Multi-Attach
  + io/1, io/2에 한하여 하나의 EBS가 여러 인스턴스에 연결 가능
  + 최대 16개 인스턴스 연결 지원
+ EBS Encryption
  + EBS를 암호화 하는 것
  + EC2 Hibernate를 위해서는 반드시 필요
  + 기존 EBS Encryption을 진행하기 위해서는 snapshot을 캡처해서 새롭게 암호화 진행해야 함

### 4. EFS (Elastic File System)
![ec2-3](assets/img/aws/ec2-storage-4.jpg){: width="972" height="589" }
+ 인스턴스와 가중 연결 가능
+ NFSv4.1 프로토콜 사용 (2049 포트)
+ 보안 그룹을 통해 제어
+ 자동 확장

+ EFS 성능 모드
  + 일반(General Purpose) - latency 적음
  + 최대 I/O - latency 비교적 높음, 높은 처리율과 다중화
+ EFS 처리율 모드
  + 버스트 - 스토리지와 처리량 비례
  + 개선된 버전
    + 프로비저닝 (Provisioning) - 사용자가 사전에 처리량을 지정
    + 탄력적 (Elastic) - 워크로드에 따라 처리량이 조정
+ EFS 스토리지 계층
  + 표준 (Standard)
  + 비정기 접근 (EFS-IA)
  + 아카이브 (Archive)
+ 파일 시스템 유형
  + 리전 (Standard) - Multi AZ
  + One-zone - One AZ, 저가용성 낮은 가격


## 3. 추가 학습한 내용

+ a. EBS Snapshot과 AMI 비교

+ b. EBS와 EFS 비교

