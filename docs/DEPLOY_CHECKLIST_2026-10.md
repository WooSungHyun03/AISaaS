# 배포 전 체크리스트 (2026-10-11 업데이트분)

운영 DB는 migration `0033`까지만 적용돼 있었습니다(`supabase migration list --linked`로 확인). **채널 진단·성장 리포트·이용권 결제가
운영에서 동작하지 않은 직접 원인**입니다(없는 테이블/컬럼을 읽고 씀). 아래 순서로 진행하세요.

## 1. DB (본인 터미널에서)

```bash
npx supabase db push --linked --dry-run   # 적용될 migration 0034~0062 목록 확인
npx supabase db push --linked
```

새로 들어가는 것: 채널 진단/성장(0034~0042, 0050), 이용권 원장·결제(0051~0054), 홍보 대상 유형(0060), 캘린더 일정(0061),
문의(0062). 모두 새 테이블/컬럼 추가라 기존 데이터를 지우지 않습니다. 적용 뒤 확인:

```bash
node --env-file=.env.local scripts/check-providers.mjs   # 결제·채널 테이블, 키 상태 점검
```

## 2. Vercel 환경변수 (직접 입력, 입력 후 재배포)

| 변수 | 용도 |
|---|---|
| `BILLING_PROVIDER=toss`, `NEXT_PUBLIC_TOSS_CLIENT_KEY`(`test_ck_…`), `TOSS_SECRET_KEY`(`test_sk_…`) | 토스 **테스트** 결제 (라이브 키는 코드가 거절) |
| `ADMIN_EMAILS` | 문의 관리자(쉼표 구분). 비우면 관리자 없음 |
| `ANTHROPIC_API_KEY`, `AI_PROVIDER=anthropic` | 글·기획 |
| `VIDEO_RENDER_PROVIDER=json2video`, `VIDEO_RENDER_API_KEY` | 숏폼 합성 (없으면 운영에서 숏폼 시작을 거절하고 이용권을 쓰지 않음) |
| `ANIMATION_PROVIDER=fal`, `FAL_KEY` | 움직이는 클립·음악 (선택) |
| `YOUTUBE_CLIENT_ID/SECRET`, `YOUTUBE_API_KEY`, `NAVER_CLIENT_ID/SECRET` | 이미 있음. 네이버 블로그는 이제 키 없이도 RSS로 진단 |

`NEXT_PUBLIC_*`는 빌드 때 들어가므로 바꾼 뒤 반드시 다시 배포하세요.

## 3. Google Cloud (YouTube Analytics)

`docs/person1/GOOGLE_CLOUD_SETUP_youtube_analytics.md` 그대로: YouTube Analytics API 켜기 → 동의 화면에 `yt-analytics.readonly`,
`youtube.readonly` 추가 → 테스트 사용자 등록 → 이미 연결한 계정은 설정에서 **다시 연결**(세 권한 모두 허용).

## 4. 스케줄러

추가 등록 없음. 채널 지표 일일 수집은 이미 등록된 5분 틱(`/api/cron/run-automations`)이 함께 처리합니다.

## 5. 확인 순서 (스모크 테스트)

1. 이용권 구매 → 토스 테스트 결제 → `이용권·결제`에서 잔여/만료 확인
2. 홍보 대상(가게/상품/플랫폼) 선택 → 블로그 한 편 → 이용내역에 사용 1회
3. 마케팅 진단: 홈페이지 주소 / 네이버 블로그 / 티스토리 / 유튜브 추가
4. 설정에서 YouTube 연결 → 성장 리포트에서 Analytics(2~3일 늦게 집계됨)
5. 캘린더에 일정 추가·반복·드래그, 문의 보내기 → 관리자 계정으로 답변
