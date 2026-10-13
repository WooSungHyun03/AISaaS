# 아키텍처 감사 — 채널 성장 리포트 작업 (2026-10-13)

범위: 구조, 중복, 성능, 보안, 데이터·상태, UX, 테스트·문서. 방침은 P0·P1만 고치고, P2는 위험이 낮을 때만 고치며, 보기 좋게 만드는 리팩터링은 하지 않는 것이었습니다.
"확인함"은 이번 작업에서 코드나 로컬 DB로 직접 본 것이고, "확인 못 함"은 운영 환경이 필요해서 못 본 것입니다.

## 요약 (이전 → 이후)

| 영역 | 이전 | 이후 |
|---|---|---|
| 채널 데이터 출처 | YouTube OAuth 연결 + Analytics(계정 필요), 공개 수집이 섞임 | 공개 데이터만(API 키·RSS). 계정·토큰·Vault 비밀값 경로 제거 |
| 수집 일정 | 채널별 `next_snapshot_at`이 흩어져 있고 06:00 보장 없음 | 모든 채널이 다음 06:00 KST에 정렬, 기존 5분 틱이 처리(새 인프라 없음) |
| 중복 수집 | 틱이 겹치면 같은 채널을 두 번 수집할 수 있음 | `next_snapshot_at` compare-and-set 선점 + 날짜별 upsert |
| 실패 처리 | 실패 횟수만 증가 | 30분 재시도 → 같은 날 3회 실패 시 다음 06:00 → 12회 연속 실패 시 일시중지, 쿼터 소진은 채널 탓으로 세지 않음 |
| 운영 가시성 | 없음 | `channel_collection_runs` + `/admin/collection`(수집 기록·"지금 수집") |
| 진실성 | 읽지 못한 블로그가 0으로 보일 수 있음 | 읽지 못하면 비움/UNAVAILABLE, 숨긴 좋아요·댓글은 null, 샘플 데이터는 배지 표시 |
| robots.txt | 확인 안 함 | 블로그 수집 전 RFC 9309 확인(허용 안 하면 "측정 불가") |

## P0 / P1 — 고친 것

1. **[P1] 블로그 수집이 robots.txt를 보지 않음.** `providers/robots.ts` 추가(그룹 선택·longest match·`*`/`$`·1시간 캐시, 4xx=허용, 5xx/연결 실패=이번엔 수집 안 함). 네이버·티스토리 수집기에 적용. 단위 테스트 9개 + 수집기 2개.
2. **[P1] 같은 채널을 두 틱이 동시에 수집할 수 있음.** CAS 선점으로 막음. 로컬 e2e에서 동시 호출 2회에 수집이 1번만 일어남을 확인.
3. **[P1] 등록 도중 부분 실패.** 시간당 진단 한도에 걸리면 채널은 저장됐는데 오류로 보였음 → 저장 성공 + 안내로 처리(`diagnosis: null`). 주소 변경은 새 채널 저장 성공 후에만 이전 채널을 삭제.
4. **[P1] 존재하지 않는 채널이 DB에 저장됨.** 등록 전에 공개 조회로 정식 Channel ID를 확인하고, 없으면 저장 전에 거부. `@핸들` 대신 `UC…` ID로 저장해 핸들이 바뀌어도 기록이 이어짐.
5. **[P1] 오래된 OAuth 비밀값이 Vault에 남음.** 마이그레이션 0075가 삭제하고 연결 행을 `DISCONNECTED`로 바꿈(행·기록은 유지).
6. **[P1] 준비 점수가 YouTube "계정 연결"을 기준으로 함.** 등록된 YouTube 채널 기준으로 변경.
7. **[P2, 저위험] 성장 리포트 카드 순서가 DB 반환 순서에 의존.** 같은 시각에 등록된 채널의 순서가 실행마다 달라질 수 있어 YouTube → 네이버 → 티스토리로 고정.
8. **[P2] 사용하지 않게 된 코드/문서 제거.** OAuth 라우트·스코프·Analytics 파이프라인·모의 수집기, 게시 코드(`shorts-publishing`), 연결 설정 UI, `config-status`, 관련 테스트·환경변수·문서.

## 확인함 (문제 없음)

- **cron 보호**: `/api/cron/run-automations`, `/api/cron/collect-metrics` 모두 `x-cron-secret`을 `safeEqual`로 비교. 비밀값 없음/틀림은 401(e2e 확인).
- **SSRF**: 사용자 주소를 가져오는 모든 경로(`fetchHop`)가 사설 주소 차단, 포트 제한, 리다이렉트마다 재검증, DNS 고정을 함. robots.txt도 같은 경로로 가져옴.
- **RLS**: 로컬 DB의 `public` 테이블 전체가 RLS 사용. 새 `channel_content_snapshots`는 소유자 읽기만, `channel_collection_runs`는 정책 없음(서비스 롤 전용). 실DB 테스트로 고객의 쓰기·타인 읽기 차단 확인.
- **SECURITY DEFINER 함수**: anon/authenticated가 실행할 수 있는 것 없음.
- **서버 비밀값**: `YOUTUBE_API_KEY`는 `serverEnv`(server-only)에서만 읽음. 로그에는 우리가 만든 메시지만 남고(`logger`가 민감 키 마스킹), 오류 요약에는 `플랫폼:ID 코드`만 저장.
- **관리자**: `/admin/collection`·"지금 수집"은 `requireAdmin`+감사 로그, 10분 쿨다운. 일반 사용자는 404(e2e 확인).
- **모의 결제 엔드포인트**: `assertMockBillingAllowed`가 운영에서 거부.
- **`dangerouslySetInnerHTML`**: 블로그 미리보기 한 곳, `renderBlogHtml`이 이스케이프한 텍스트와 고정 태그만 생성.
- **성능**: 틱당 채널 수와 시간 예산 제한, 스냅샷 페이지 단위 읽기, `tracked_channels_due_idx`(due 조회), 영상별 스냅샷은 채널당 20,000행 상한 트리거, 200일 지난 스냅샷 정리. 채널당 하루 약 3 YouTube 유닛.

## 남긴 것 (P2, 이번엔 건드리지 않음)

- YouTube API 키가 쿼리스트링(`key=`)으로 전달됨. 현재 로그·오류 메시지로 새지 않는 것은 확인했지만, `X-Goog-Api-Key` 헤더로 바꾸는 편이 더 안전함. 실제 키로 검증할 수 없어 바꾸지 않았음.
- `website-diagnosis-card.tsx`(클라이언트)가 `@/server/marketing/scoring`의 상수를 import함(서버 전용 의존 없음, 번들만 약간 커짐).
- 홈페이지 진단 카드의 날짜가 서버/브라우저 ICU에 따라 "오후"/"PM"으로 달라 로컬에서 하이드레이션 경고가 남(운영 Node는 full-ICU라 같음). 새 성장 카드는 24시간제로 같은 문제를 피함.
- `docs/ARCHITECTURE.md`의 Instagram/OAuth 이력 구간은 역사 기록으로 두고 폐기 표시만 함.
- 로컬 Node ICU 때문에 로컬 스크린샷에서 일부 시각이 "PM"으로 보일 수 있음(운영 영향 없음).

## 확인 못 함 (운영·실제 키 필요)

- 운영에서 실제 06:00 KST 틱이 돌아 수집되는지. `cron.job`에 `run-due-automations`가 활성인지, Vercel `CRON_SECRET`과 Edge Function secret이 같은지.
- 실제 YouTube Data API 응답(키 없이는 mock·단위 테스트로만 확인). 숨긴 구독자 수, 쿼터 소진(`quotaExceeded`) 응답의 실제 모양.
- 실제 네이버·티스토리 RSS와 robots.txt 응답. 네이버(`rss.blog.naver.com`)가 자동 수집을 허용하지 않으면 해당 블로그는 "측정 불가"로 표시됨.
- 운영 DB에 마이그레이션 0075 적용(사용자 몫, `docs/DEPLOY_CHECKLIST_2026-10.md` 참고).
