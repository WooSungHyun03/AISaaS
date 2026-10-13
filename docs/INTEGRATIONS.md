# 외부 서비스 연결 (2026-10-11)

앱이 연결하는 외부 서비스는 **YouTube** 하나뿐입니다. (Instagram은 API 사용이 불가능해서 2026-10-13에 연결·게시 기능을 모두 제거했어요.)

| 서비스 | 판정 | 쓰임 |
|---|---|---|
| YouTube | 유지 | 숏폼 업로드, 성장 리포트 Analytics (`youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`) |
| Instagram | **삭제** (2026-10-13) | Meta API 사용 불가. 연결·OAuth·Reels 게시·인스타그램 자동화 핸들러를 제거했고, 숏폼 게시 문구의 Instagram 캡션은 직접 복사해 올리도록 남겨두었어요 |
| WordPress | **삭제** | 블로그 글은 앱에서 확인하고 직접 올리는 방식 |
| 이메일(Resend)·뉴스레터 | **삭제** | 제공하지 않는 기능 |

## 삭제한 것

- 코드: `connectors/wordpress`, `connectors/email`, 뉴스레터 핸들러·프롬프트, 설정 화면의 WordPress 연결, 블로그 설정의 WordPress 항목,
  `WORDPRESS_*`·`RESEND_*` 환경변수, 템플릿 목록의 `newsletter`
- 데이터(`0063_remove_wordpress_email.sql`): WordPress/이메일 연결의 Vault 비밀값과 연결 행, 블로그 자동화 설정 안의 WordPress 정보
  (암호화된 앱 비밀번호 포함, `deliveryMode`는 `app_draft`로), `newsletter` 템플릿 비활성화, `integration_connections.provider`를
  `instagram`/`youtube`로 제한
- 남겨둔 것: 구독자 목록 테이블(`subscribers`, 고객 데이터), 옛 migration 파일(이력)
- 예전에 WordPress 전달로 저장된 블로그 자동화도 그대로 실행되며, 이제는 결과를 앱에만 저장합니다.
