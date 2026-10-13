# 외부 서비스 설정 안내 (결제 · YouTube)

코드로 고칠 수 있는 부분은 모두 코드에 반영되어 있습니다. 아래는 **콘솔에서 사람이 직접** 해야 하는 설정입니다.
키 값은 절대 저장소·채팅·스크린샷에 남기지 말고 Vercel 환경변수에만 넣으세요. 환경변수를 바꾼 뒤에는 **다시 배포**해야 적용됩니다
(`NEXT_PUBLIC_*` 값은 빌드 때 번들에 들어갑니다).

배포 환경이 설정됐는지는 `npm run check:providers`(또는 `node scripts/check-providers.mjs`)로 확인할 수 있고, 관리자 계정으로 설정 화면을 열면
비어 있는 변수 이름과 등록할 Redirect URI가 그대로 표시됩니다.

## 1. 결제 (Toss Payments, 테스트 모드)

| 변수 | 위치 | 값 |
| --- | --- | --- |
| `BILLING_PROVIDER` | Vercel (Production) | `toss` |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` (별칭 `TOSS_CLIENT_KEY`) | Vercel | 토스 개발자센터 → API 키 → 클라이언트 키 `test_ck_…` |
| `TOSS_SECRET_KEY` | Vercel | 시크릿 키 `test_sk_…` |
| `NEXT_PUBLIC_SITE_URL` | Vercel | 실제 배포 주소(예: `https://example.vercel.app`) |

- 클라이언트 키와 시크릿 키는 **둘 다 테스트 키**여야 합니다. 라이브 키가 섞이면 앱이 결제를 시작하지 않고 `BILLING_KEYS_NOT_TEST`로 막습니다(실결제 방지).
- `NEXT_PUBLIC_TOSS_CLIENT_KEY`는 빌드 때 번들에 들어가므로 값을 바꾸면 반드시 재배포하세요. 서버가 `TOSS_CLIENT_KEY`도 읽기 때문에 변수 이름을 틀려도 서버 쪽에서 복구됩니다.
- 결제 성공/실패 URL은 앱이 요청마다 `NEXT_PUBLIC_SITE_URL` 기준으로 만들어 토스에 전달하므로 토스 콘솔에 따로 등록할 Redirect URL은 없습니다.
- 웹훅: 현재 결제 확정은 성공 URL(`/billing/success`)에서 서버가 토스 승인 API를 호출해 처리하며 웹훅에 의존하지 않습니다. 이용권 지급은 `complete_billing_order`가 주문당 한 번만 처리해 새로고침·중복 확인에도 이중 지급되지 않습니다.

Vercel에서는 각 변수의 **적용 환경(Environment)** 도 확인하세요. 값이 맞아도 `Preview`에만 걸려 있으면 `be-celeb.org`(Production)에서는 비어 있는 것과 같아요. 2026-10-13 점검에서 `BILLING_PROVIDER`와 `AI_PROVIDER`가 Preview에만 설정돼 있었어요 — 둘 다 Production에도 체크해야 합니다(`BILLING_PROVIDER=toss`, `AI_PROVIDER=anthropic`).

실패 화면의 코드 → 원인

| 코드 | 의미 | 조치 |
| --- | --- | --- |
| `BILLING_NOT_CONFIGURED` | 결제 설정이 비어 있음 | 위 표의 변수 확인 |
| `BILLING_CLIENT_KEY_MISSING` | 클라이언트 키 없음 | `NEXT_PUBLIC_TOSS_CLIENT_KEY` 추가 후 재배포 |
| `BILLING_KEYS_NOT_TEST` | 테스트 키가 아님 | `test_ck_` / `test_sk_` 키로 교체 |
| `BILLING_PROVIDER_MOCK` | 운영에서 모의 결제로 설정됨 | `BILLING_PROVIDER=toss` |

관리자 계정에게만 위 원인이 화면에 보이고, 일반 사용자에게는 "결제를 시작하지 못했어요. 잠시 후 다시 시도해주세요" 수준만 보입니다.

## 2. YouTube (Google OAuth)

환경변수: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` (Vercel)

Google Cloud Console에서:

1. 프로젝트 선택 → API 및 서비스 → 라이브러리에서 **YouTube Data API v3**와 **YouTube Analytics API**를 사용 설정.
2. OAuth 동의 화면: 앱 이름·지원 이메일 입력, 범위에 아래 3개 추가.
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
3. 게시 상태가 "테스트"이면 **테스트 사용자**에 연결할 Google 계정을 등록(미등록 계정은 동의 화면에서 막힘). 운영 공개는 Google 검증(민감 범위) 필요.
4. 사용자 인증 정보 → OAuth 클라이언트 ID(유형: 웹 애플리케이션) 생성.
   - 승인된 리디렉션 URI: `<NEXT_PUBLIC_SITE_URL>/api/integrations/youtube/callback` (로컬은 `http://localhost:3000/api/integrations/youtube/callback`)
5. 클라이언트 ID/보안 비밀번호를 Vercel에 넣고 재배포.

앱은 `access_type=offline`, `prompt=consent`로 요청해 refresh token을 받고, 액세스 토큰은 만료 전에 자동 갱신합니다. 일부 범위를 해제하고 연결하면
"연결됨(Analytics 제외)"으로 표시되며 설정 화면의 **다시 연결**로 재동의할 수 있습니다. 자세한 내용: `docs/person1/GOOGLE_CLOUD_SETUP_youtube_analytics.md`.

### 현재 상태 (2026-10-13, Google Cloud 프로젝트 `be-celeb`)

- YouTube Data API v3, YouTube Analytics API: 사용 설정됨.
- Google 인증 플랫폼: 사용자 유형을 **내부 → 외부**(게시 상태 **테스트 중**)로 바꿨어요. 내부(조직 전용)이면 조직 밖 Google 계정은 연결할 수 없습니다.
- 데이터 액세스(범위) 3개 등록·저장: `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`.
- 테스트 사용자: `2242798@donga.ac.kr` 1명. YouTube를 연결할 다른 Google 계정은 **대상 → 테스트 사용자**에 직접 추가해야 해요(최대 100명).
- OAuth 클라이언트 `Easy Marketing Web`(웹 애플리케이션) 생성: 승인된 리디렉션 URI `https://be-celeb.org/api/integrations/youtube/callback`, 승인된 JavaScript 원본 `https://be-celeb.org`.
- **남은 일(사람이 해야 함)**: 클라이언트 ID와 보안 비밀번호를 Vercel 환경변수 `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`(Production)에 넣고 재배포. 보안 비밀번호는 생성 직후 한 번만 보이므로 놓쳤다면 클라이언트 상세 화면에서 새 비밀번호를 추가하세요.
- 테스트 중 상태에서는 리프레시 토큰이 7일 뒤 만료돼요. 장기 운영하려면 게시 상태를 프로덕션으로 올리고 Google 검증(민감한 범위)을 받아야 합니다.

## 연결 상태가 안 풀릴 때 확인 순서

1. 설정 화면 버튼이 "연동 준비 중"이면 환경변수 미설정입니다(관리자 계정에서 변수 이름이 표시됨).
2. 클릭 후 Google 오류 화면이면 Redirect URI·테스트 사용자를 확인하세요.
3. 돌아왔을 때 "취소했어요"는 사용자가 거부한 경우, "만료됐거나 확인할 수 없어요"는 10분 안에 끝내지 못했거나 쿠키가 막힌 경우입니다.
