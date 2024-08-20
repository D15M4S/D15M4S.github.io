---
title: SQLD - 2과목. SQL 기본 및 활용 - SQL 기본편
description: SQL 기본 - SELECT, FROM, WHERE, GROUP BY, ORDER BY, JOIN 
author: D15M4S
categories: [자격증, SQLD]
tags: [자격증, SQLD, SQL]
pin: false
image:
  path: assets/img/contents/sqld/sqld-profile.jpg
---

## 1. 학습 내용
![0](assets/img/contents/sqld/sqld-sql-basic-advance-1.jpg)
+ **PART 1. SQL 기본**
  + 관계형 데이터베이스 개요
  + SELECT
  + 함수
  + WHERE
  + GROUP BY, HAVING
  + ORDER BY
  + JOIN
  + 표준 조인


## 2. 정리

학습한 내용을 정리하였다.

### PART 1. SQL 기본

#### 1. 관계형 데이터베이스 개요

+ SQL 분류
  + DML - `select` `insert` `update` `delete`
  + DDL - `create` `alter` `drop` `rename`
  + DCL - `grant` `revoke`
  + TCL - `commit` 'rollback'

#### 2. SELECT
![1](assets/img/contents/sqld/sqld-sql-basic-advance-2.jpg)
#### 3. 함수
![2](assets/img/contents/sqld/sqld-sql-basic-advance-3.jpg)

+ 단일행 문자열 함수
  + LOWER(문자열)
  + UPPER(문자열)
  + ASCII(문자)
  + CHR/CHAR(문자) <-> ASCII(문자)
  + SUBSTR/SUBSTRING(문자열, M, [N])
  + LENGTH(문자열)
  + LTRIM(문자열, 지정문자)
  + RTRIM(문자열, 지정문자)

![3](assets/img/contents/sqld/sqld-sql-basic-advance-4.jpg)

+ 단일행 NULL 관련 함수
  + NVL(표현식1, 표현식2) - 표현식 1이 null이면 표현식2 출력
  + ISNULL(표현식1, 표현식2) - 위와 같음
  + NULLIF(표현식1, 표현식2) - 표현식1과 표현식2가 같으면 NULL을 같지 않으면 표현식 1을 반환
  + COALESCE(표현식1, 표현식2, ...) - NULL이 아닌 최초의 표현식 출력

#### 4. WHERE
![4](assets/img/contents/sqld/sqld-sql-basic-advance-5.jpg)
#### 5. GROUP BY, HAVING
![5](assets/img/contents/sqld/sqld-sql-basic-advance-6.jpg)
#### 6. ORDER BY
![6](assets/img/contents/sqld/sqld-sql-basic-advance-7.jpg)
#### 7. JOIN
![7](assets/img/contents/sqld/sqld-sql-basic-advance-8.jpg)
#### 8. 표준 조인
![8](assets/img/contents/sqld/sqld-sql-basic-advance-9.jpg)

## 3. SQL 자격검정 실전문제 풀이 후 약점 분석

SQL 자격 검정 실전문제 풀이 후 약점이 되는 부분이 무엇인지, 보완해야 할 부분이 무엇인지 분석하였다.

해당 부분은 한국데이터산업진흥원에서 제시한 **출제 포인트**라는 점에서 확실히 이해, 암기해야 한다.

#### 1번 - 5번

DML, DDL, DCL, TCL을 구분하는 문제 출제, 특히 DCL과 TCL 부분을 자세히 확인하는 것이 중요하다.

#### 8번 - 그룹함수와 WHERE 절

그룹함수는 SELECT절과 HAVING절에서만 사용할 수 있다는 점을 체크하자

#### 9번, 10번, 50번 NULL 연산

NULL 연산이 함수 패러미터 내에서 어떻게 수행되는 지를 그 과정을 명확히 이해해야 한다.
+ 각 함수는 행 하나하나 차례차례 적용된다는 점을 숙지하자. 
+ 함수의 행 단위 계산에서 NULL이 포함되어 있다면 NULL이 반환된다.
+ 함수의 전체 계산 결과 NULL이 있을 경우 NULL을 무시한 결과값이 반환된다.
+ NULL 과의 비교는 항상 FALSE를 리턴한다.

WHERE 절에서 NULL 비교 시 `IS NULL`, `IS NOT NULL`을 사용해야 한다.

#### 11번 ORACLE과 SQL Server 간 '' 처리 비교

ORACLE은 `NULL`로 SQL Server은 `빈 문자열`로 인식하여 처리한다.

#### 17번, 18번 단일행 조건 함수

+ DECODE와 CASE WHEN 사용 방법을 명확히 숙지할 것
  + `CASE 대상 WHEN 조건` `CASE WHEN (대상 + 조건)` 두 가지 버전이 있음을 확인하자!

#### 20번 NULL 처리 함수

+ NULL 처리 함수에 대해 명확히 숙지할 것
  + NVL(ORACLE), ISNULL(SQL Server)
  + NULLIF(A, B) - A와 B가 같을 경우 NULL
  + COALESCE(A, B, C, D) - 파라미터를 순차적으로 순회, NULL이 아닐 경우 해당 파라미터 반환

#### 21번 별칭 AS절 생략과 ORDER BY에서 정수를 통해 SELECT 속성 지정

+ SELECT 절에 선언된 순서대로의 정수를 전달할 수 있다. (인덱스는 1부터 시작한다)

#### 26번 COMMIT, ROLLBACK, SAVEPOINT 사용법

+ COMMIT - 지금까지의 상태를 실제 데이터베이스에 반영한다
+ ROLLBACK - 지금까지의 상태를 마지막 COMMIT으로 되돌린다.
+ SAVEPOINT - 지금까지의 상태를 저장한다. (실제 데이터베이스에 전달되지는 않는다.)
+ ROLLBACK TO SAVEPOINT (세이브포인트 이름) - 지금까지의 상태를 해당 세이브 포인트로 되돌린다.

#### 27번 GROUP BY 에서의 NULL 처리

+ GROUP BY에서 NULL 또한 요약/집계의 대상이 된다.

#### 28번 ORDER BY와 조건문

+ ORDER BY (조건문)을 통해 특정 행의 정렬 위치를 조정할 수 있다.
  + 오름차순 정렬 시, `ORDER BY (CASE TARGET WHEN 9999 THEN 0 ELSE TARGET END`과 같이 SQL문을 구성할 경우 TARGET이 9999인 행을 제일 앞 순위에 배치할 수 있다.
  + ORDER BY에서 사용한 조건절로 인해 실제 데이터가 변하지는 않는다.

#### 29번 GROUP BY로 인해 발생하는 SELECT 문과 ORDER BY 제약조건

+ GROUP BY 절이 사용되었을 경우 SELECT, ORDER BY에서는 GROUP BY의 대상, 집계함수만을 사용해야 한다.

#### 35번 DBMS 옵티마이저

+ DBMS 옵티마이저는 DBMS에서 SQL 쿼리를 효율적으로 실행할 수 있는 방법을 찾아주는 서비스이다.
  + DBMS 옵티마이저는 FROM 절에서 항상 2개 테이블 씩 짝을 지어 JOIN절을 수행한다.

#### 36번 LIKE 연산자를 이용한 JOIN 이해

+ 엔티티의 속성 값에 LIKE 표현식 (%, _)이 포함되어 있을 경우 + 문자열 패턴 매칭 시 사용한다.
   + 그 외 사용은 INNER JOIN과 같다 표현식과 매칭되는 모든 행을 반환한다.

#### 37번 순수 관계 연산자

+ 관계 대수(수학)에서 사용하는 연산자이다. `SELECT`, `PROJECT`, `JOIN`, `DIVIDE`가 있다.

#### 42번 ANSI 표준 USING 절

+ `USING(공통속성명)` - USING 절에 두 테이블의 공통속성명을 넣어 조인을 시도한다.

#### 45번 FULL OUTER JOIN 구현

#### 49번 ORACLE JOIN절 ANSI 표준으로 변환
