# 외부 서비스 연결 — 무엇을 쓰고, 무엇을 정리했나 (2026-10-11)

설정 화면의 "외부 서비스 연결"에는 지금 제품이 실제로 쓰는 것만 보입니다. 코드와 데이터는 지우지 않았고(기존 사용자·migration
기록 보호), 화면과 안내만 정리했습니다.

| 서비스 | 판정 | 이유 / 실제 참조 |
|---|---|---|
| **YouTube** | KEEP | 숏폼 업로드(`connectors/youtube`, `shorts-publishing.ts`) + 성장 리포트 Analytics(`channels/youtube-analytics-pipeline.ts`). OAuth 스코프 `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` |
| **Instagram** | KEEP | 숏폼 → Instagram Reels 게시(`connectors/instagram`, 숏폼 스튜디오의 게시 대상). 설명 문구를 "릴스 게시용"으로 바로잡음 |
| **WordPress** | DEPRECATE | 새 블로그 글은 앱에서 확인하고 직접 올리는 방식(`blogSetupSchema`가 새 자동화는 `app_draft`만 허용). 기존 WordPress 연결이 있는 계정에만 "이전 방식"으로 보이고 해제할 수 있음. 커넥터·`WORDPRESS_*` env는 기존 자동화를 위해 유지 |
| **이메일(Resend)** | DEPRECATE | 뉴스레터 자동화는 `COMING_SOON`. 기존 이메일 연결이 있는 계정에만 보임. `RESEND_*` env 유지 |
| 뉴스레터·인스타 카드·고객응대 템플릿 | 숨김 | `AUTOMATION_AVAILABILITY`가 `COMING_SOON` → 마켓플레이스에 나열하지 않음(이미 반영돼 있었음) |

## 데이터 의존성 확인

- `integration_connections.provider`의 허용 값(`wordpress`, `instagram`, `email`, `youtube`)은 그대로 둡니다. 기존 행과 migration
  이력을 건드리지 않습니다.
- WordPress 전달을 쓰던 블로그 자동화(`config.deliveryMode = wordpress_*`)는 계속 실행됩니다(`handlers/blog.ts`의 `deliver`).
- 제거를 완전히 하려면(별도 티켓): 기존 WordPress/이메일 연결 사용자를 모두 해제시킨 뒤 `connectors/wordpress`, `connectors/email`,
  설정 다이얼로그의 WordPress 항목, `.env` 값을 삭제하세요. 지금은 사용자 데이터 보호를 위해 하지 않았습니다.
