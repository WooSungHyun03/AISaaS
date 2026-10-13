# 외부 서비스 설정 안내 (결제 · YouTube 공개 데이터)

코드로 고칠 수 있는 부분은 모두 코드에 반영되어 있습니다. 아래는 **콘솔에서 사람이 직접** 해야 하는 설정입니다.
키 값은 절대 저장소·채팅·스크린샷에 남기지 말고 Vercel 환경변수에만 넣으세요. 환경변수를 바꾼 뒤에는 **다시 배포**해야 적용됩니다
(`NEXT_PUBLIC_*` 값은 빌드 때 번들에 들어갑니다).

배포 환경이 설정됐는지는 `npm run check:providers`(또는 `node scripts/check-providers.mjs`)로 확인할 수 있고, 관리자 계정으로 설정 화면을 열면
비어 있는 변수 이름이 그대로 표시됩니다.

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

## 2. YouTube (공개 데이터 수집 — API 키만)

환경변수: `YOUTUBE_API_KEY` (Vercel, **Production에 체크**). 서버 전용 값이라 `NEXT_PUBLIC_` 을 붙이지 마세요.

2026-10-13부터 앱은 YouTube **계정 연결(OAuth)을 하지 않습니다.** 사용자는 채널 주소(`youtube.com/@핸들`)만 등록하고, 서버가 YouTube Data API v3로
**누구에게나 공개된 값**(채널명·구독자·누적 조회수·영상 수·최근 영상의 조회/좋아요/댓글)만 읽어요. 그래서 로그인·동의 화면·테스트 사용자 등록이 필요 없습니다.

Google Cloud Console에서:

1. 프로젝트 선택 → API 및 서비스 → 라이브러리에서 **YouTube Data API v3** 사용 설정. (YouTube Analytics API는 더 이상 쓰지 않아요.)
2. 사용자 인증 정보 → **API 키** 생성 → 키 제한: API 제한을 *YouTube Data API v3* 만 허용(서버에서만 쓰므로 애플리케이션 제한은 선택).
3. 키를 Vercel `YOUTUBE_API_KEY`(Production)에 넣고 재배포.
4. `CHANNEL_DATA_PROVIDER` 는 비워 두거나 `live`. `mock` 은 운영에서 거부되고, 로컬에서는 샘플 데이터(화면에 "샘플 데이터" 표시)를 만듭니다.

할당량: 기본 하루 10,000 유닛. 채널 1개를 하루 한 번 수집하는 데 약 3유닛(channels.list, playlistItems.list, videos.list 각 1)이 들고, 등록 확인(미리보기)이 1유닛입니다.
소진되면 그날은 YouTube 수집을 멈추고 1시간 뒤 다시 시도하며(채널 탓으로 세지 않아요), 관리자 `/admin/collection` 에 "YouTube 할당량 소진"으로 남습니다.

### 이전 OAuth 설정 정리 (사람이 해야 함)

- Vercel 환경변수 `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` 이 있다면 **삭제**하세요(코드는 더 이상 읽지 않아요).
- Google Cloud의 OAuth 클라이언트 `Easy Marketing Web` 과 동의 화면은 쓰이지 않습니다. 필요 없으면 삭제해도 됩니다(2026-10-13에 만들어 둔 것).
- 기존에 연결돼 있던 사용자의 토큰은 마이그레이션 `0075` 가 Vault에서 지우고 연결 행을 `DISCONNECTED` 로 바꿉니다. 이미 모은 기록은 그대로입니다.
