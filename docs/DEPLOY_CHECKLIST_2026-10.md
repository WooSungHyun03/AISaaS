# 배포 전 체크리스트 (2026-10-11 업데이트분)

운영 DB는 migration `0033`까지만 적용돼 있었습니다(`supabase migration list --linked`로 확인). **채널 진단·성장 리포트·이용권 결제가
운영에서 동작하지 않은 직접 원인**입니다(없는 테이블/컬럼을 읽고 씀). 아래 순서로 진행하세요.

## 1. DB (본인 터미널에서)

```bash
npx supabase db push --linked --dry-run   # 적용될 migration 0034~0066 목록 확인
npx supabase db push --linked
```

새로 들어가는 것: 채널 진단/성장(0034~0042, 0050), 이용권 원장·결제(0051~0054), 홍보 대상 유형(0060), 캘린더 일정(0061),
문의(0062), WordPress·이메일 연결 정리(0063), 사용자 환불 요청(0064), 관리자 권한·감사 로그(0065), 관리자 운영·환불 원장·계정 정지(0066).

> **0063은 데이터 정리 migration입니다.** 더 이상 제공하지 않는 WordPress·이메일 연결의 Vault 비밀값과 연결 행을 삭제하고,
> 기존 블로그 자동화를 앱 초안 모드로 바꿉니다. 적용 전에 해당 연동을 되돌릴 필요가 없는지 확인하세요. 0034~0062와 0064~0066은
> 기존 데이터를 삭제하지 않는 추가 변경입니다. 0065~0066 적용만으로 운영 관리자가 자동 등록되지는 않습니다.

적용 뒤 확인:

```bash
node --env-file=.env.local scripts/check-providers.mjs   # 결제·문의·환불·채널 테이블, 키 상태 점검
```

## 2. Vercel 환경변수 (직접 입력, 입력 후 재배포)

| 변수 | 용도 |
|---|---|
| `BILLING_PROVIDER=toss`, `NEXT_PUBLIC_TOSS_CLIENT_KEY`(`test_ck_…`), `TOSS_SECRET_KEY`(`test_sk_…`) | 토스 **테스트** 결제 (라이브 키는 코드가 거절) |
| `ANTHROPIC_API_KEY`, `AI_PROVIDER=anthropic` | 글·기획 |
| `VIDEO_RENDER_PROVIDER=json2video`, `VIDEO_RENDER_API_KEY` | 숏폼 합성 (없으면 운영에서 숏폼 시작을 거절하고 이용권을 쓰지 않음) |
| `ANIMATION_PROVIDER=fal`, `FAL_KEY` | 움직이는 클립·음악 (선택) |
| `YOUTUBE_CLIENT_ID/SECRET`, `YOUTUBE_API_KEY`, `NAVER_CLIENT_ID/SECRET` | 이미 있음. 네이버 블로그는 이제 키 없이도 RSS로 진단 |

`NEXT_PUBLIC_*`는 빌드 때 들어가므로 바꾼 뒤 반드시 다시 배포하세요.

## 3. 운영 최초 관리자 등록

운영 관리자 계정으로 회원가입과 이메일 확인을 마친 다음, `docs/ADMIN_BOOTSTRAP.sql`의 이메일을 바꿔 Supabase SQL Editor에서 한 번 실행하세요. 관리자 등록 화면은 제공하지 않습니다. 등록 후 `/admin`에서 대시보드가 열리고 `admin_audit_log`에 접근 기록이 추가되는지 확인합니다.

## 4. Google Cloud (YouTube Analytics)

`docs/person1/GOOGLE_CLOUD_SETUP_youtube_analytics.md` 그대로: YouTube Analytics API 켜기 → 동의 화면에 `yt-analytics.readonly`,
`youtube.readonly` 추가 → 테스트 사용자 등록 → 이미 연결한 계정은 설정에서 **다시 연결**(세 권한 모두 허용).

## 5. 스케줄러

추가 등록 없음. 채널 지표 일일 수집은 이미 등록된 5분 틱(`/api/cron/run-automations`)이 함께 처리합니다.

## 6. 확인 순서 (스모크 테스트)

1. 이용권 구매 → 토스 테스트 결제 → `이용권·결제`에서 잔여/만료 확인
2. 홍보 대상(가게/상품/플랫폼) 선택 → 블로그 한 편 → 이용내역에 사용 1회
3. 마케팅 진단: 홈페이지 주소 / 네이버 블로그 / 티스토리 / 유튜브 추가
4. 설정에서 YouTube 연결 → 성장 리포트에서 Analytics(2~3일 늦게 집계됨)
5. 캘린더에 일정 추가·반복·드래그, 문의 보내기 → 관리자 계정으로 답변
6. 테스트 주문의 환불 요청 제출 → 같은 주문 중복 제출 차단 → 요청 상태 확인 (자동 환불은 실행되지 않음)
7. 비로그인·일반 사용자의 `/admin` 접근 차단 → 관리자 로그인 → 대시보드 수치·최근 결제/오류/환불/문의 확인 → 감사 로그 생성 확인
8. `/admin/refunds`에서 검토 → 승인 → 환불 실행. 주문 `REFUNDED`, grant 잔여 0, `credit_ledger.REFUND`, 요청 `REFUNDED`를 함께 확인
9. `/admin/users`에서 테스트 사용자를 정지한 뒤 새 로그인과 기존 세션의 앱 진입이 차단되는지 확인하고 다시 활성화

## 7. 관리자 운영 정책

- 계정 정지는 `profiles.account_status=SUSPENDED`와 Supabase Auth 장기 ban을 함께 적용합니다. 새 로그인과 기존 앱 세션의 보호 화면 접근이 차단되며 사용자 데이터는 삭제하지 않습니다.
- 환불 승인은 해당 주문의 미사용 크레딧을 즉시 예약 대상에서 제외합니다. 결제 취소가 성공하면 주문·크레딧·불변 원장·환불 요청을 한 DB 트랜잭션으로 확정합니다.
- 토스 취소 실패나 네트워크 결과 불명확 시 요청은 `APPROVED`로 남습니다. 관리자는 같은 `refund_idempotency_key`로 다시 실행할 수 있습니다.
- 토스 연동은 `test_` 키만 허용합니다. 운영 키를 넣으면 결제와 환불 실행이 모두 거부됩니다.
