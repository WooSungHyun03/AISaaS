# 외부 서비스 연결 (2026-10-11)

앱이 **로그인·계정 연결(OAuth)을 요구하는 외부 서비스는 없습니다.** (Instagram은 API 사용 불가로 2026-10-13에 제거, YouTube는 같은 날 계정 연결을 없애고 공개 데이터 수집으로 바꿨어요.)

| 서비스 | 판정 | 쓰임 |
|---|---|---|
| YouTube | **공개 데이터만** (2026-10-13) | 채널 주소 등록 → Data API v3(API 키)로 공개 지표를 매일 06:00 KST에 수집. 영상 업로드는 사용자가 YouTube Studio에서 직접 |
| 네이버 블로그·티스토리 | 공개 RSS만 | 글 목록·게시일. robots.txt를 따르고 로그인하지 않으며, 읽지 못하면 "측정 불가"로 표시(0으로 채우지 않음) |
| Instagram | **삭제** (2026-10-13) | Meta API 사용 불가 |
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
