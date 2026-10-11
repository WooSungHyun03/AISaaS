# 팀장에게: 티켓 1-10 — YouTube Analytics용 구글 클라우드 설정

티켓 1-10 원문에 "구글 클라우드 설정은 팀장이 한다"고 되어 있어서, 코드 쪽(사람1/Dev1)이
끝나기 전에 아래 설정을 해주시면 됩니다. 저(에이전트)는 구글 클라우드 콘솔을 직접 건드리지
않았습니다 — 문서로만 정리합니다.

## 해야 할 설정

### 1. API 활성화

이미 YouTube Data API v3를 쓰고 있을 테니, 추가로 **YouTube Analytics API**를
활성화해주세요.
- 구글 클라우드 콘솔 → 해당 프로젝트 → "API 및 서비스" → "라이브러리" →
  "YouTube Analytics API" 검색 → 활성화.

### 2. OAuth 동의 화면에 스코프 추가

기존 동의 화면(이미 업로드 스코프로 설정되어 있을 것)에 아래 스코프를 추가해주세요.
- `https://www.googleapis.com/auth/yt-analytics.readonly` (Analytics 보고서)
- `https://www.googleapis.com/auth/youtube.readonly` (로그인한 구글 계정이 추적 중인 채널의 실제 주인인지 확인 — `channels.list` 는 `youtube.upload` 만으로는 호출할 수 없어요)

앱이 요청하는 스코프는 이제 `youtube.upload` + `youtube.readonly` + `yt-analytics.readonly` 세 개입니다
(`src/lib/youtube-scopes.ts`). 동의 화면에서 사용자가 일부를 해제하면 연결은 되지만 Analytics 는
수집되지 않고, 성장 리포트/설정에 "다시 연결" 안내가 나옵니다.

"민감한 범위(sensitive scope)"로 분류될 수 있어서, 테스트 모드에서는 심사 없이
**테스트 사용자로 등록된 계정까지만** 동작합니다(티켓 원문에도 "심사 전이어도 테스트
사용자 100명까지 가능"이라고 적혀 있어서, 학교 프로젝트 규모면 충분합니다).

### 3. 테스트 사용자 등록

Analytics로 실제 테스트를 해볼 계정(팀원 본인의 YouTube 채널 계정 등)을 OAuth 동의
화면의 "테스트 사용자" 목록에 추가해주세요. 등록 안 된 계정은 동의 화면에서 바로
막힙니다.

### 4. 리디렉션 URI — 변경 불필요

스코프를 추가하는 것뿐이라 `redirect_uri`는 바뀌지 않습니다. 기존 YouTube 연결
리디렉션 URI 설정을 그대로 쓰시면 됩니다.

### 5. 기존 연결 사용자의 재동의

API/스코프를 활성화해도 **이미 연결된 사용자에게 자동으로 적용되지는 않습니다.**
기존 "YouTube 연결하기" 버튼을 한 번 더 눌러야 새 스코프까지 포함한 토큰을 받습니다
(Dev1 쪽에 별도 재동의 UI 없이 기존 버튼 재사용으로 처리하도록 요청해뒀습니다 —
`docs/person1/REQUEST_FOR_DEV1_youtube_analytics.md` 참고). 팀 내부 테스트 계정들은
이 사실을 공유해주시면 좋겠습니다.

## 참고: 데이터 지연

YouTube Analytics API는 공식 문서상 48~72시간 처리 지연이 있습니다. 연결/스코프
설정을 마쳐도 **최근 2~3일치 데이터는 바로 보이지 않는 게 정상**입니다(버그 아님).

## 해제 후 데이터

연결을 해제해도 그동안 쌓인 Analytics 데이터(`yt_analytics.*`)는 DB에서 삭제되지
않고 보존됩니다. 다만 성장 리포트 화면에는 연결이 끊긴 순간부터 더 표시되지
않습니다(연결된 채널에만 노출). 필요하면 나중에 "연결 해제 즉시 삭제" 정책을
별도 티켓으로 추가할 수 있습니다 — 이번 범위에는 포함하지 않았습니다.

## 이번 작업에서 팀장이 직접 할 필요 없는 것

- DB migration: 이번 티켓은 migration이 0건입니다(기존 테이블/제약으로 충분).
- pg_cron 등록: 기존 1-6 수집 cron(`processDueChannels`)에 얹혀서 돌아가므로 추가
  cron 설정이 필요 없습니다.

## 구현 상태 (2026-10-11)

코드 쪽은 모두 끝났습니다. 실제 계정 검증만 남아 있어요.

- 호출: `src/server/connectors/youtube/analytics.ts` — `reports.query`
  (`ids=channel==MINE`, `dimensions=day`, `views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost`)
- 토큰: Vault 에 저장된 refresh token 으로 매번 access token 을 새로 받음(로그·응답에 남기지 않음)
- 소유자 검증: 연결 시 저장한 `metadata.channelId` 와 추적 중인 채널(`@핸들`이면 `forHandle` 로 id 확인)이 다르면 수집하지 않고 `CHANNEL_MISMATCH` 로 기록
- 저장: `yt_analytics.views / estimatedMinutesWatched / averageViewDuration / netSubscribers` (날짜는 API 가 준 `day`)
- 표시: 성장 리포트는 하루 단위 값을 **기간 합계(평균 지속시간은 평균)** 로 이전 기간과 비교. 48~72시간 지연 때문에 기간은 오늘 3일 전까지로 잡음
- 실패 사유(`TOKEN_REVOKED`, `SCOPE_MISSING`, `API_DISABLED`, `QUOTA`, `CHANNEL_MISMATCH`, `WAITING_FOR_DATA`)는 연결의 `metadata.analytics.status` 에 남아 화면에 안내 문구로 나옴
- 데이터 API(공개 통계: 구독자·총 조회수)와 Analytics API(소유자 전용 기간 지표)는 다른 지표로 취급하며 표시도 구분(`EXTERNAL_VERIFIED` 배지)

실제 검증 순서: 위 1~3 설정 → 배포 → 설정 화면에서 YouTube **다시 연결**(세 권한 모두 체크) → 성장 리포트에서 "지금 수집" → 2~3일 전 데이터가 보이면 정상.
