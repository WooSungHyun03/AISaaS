import type { Metadata } from "next";
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "Easy Marketing이 수집하는 정보, 이용 목적, 보관 기간, 처리 위탁과 이용자 권리 안내.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS: LegalSection[] = [
  {
    title: "수집하는 정보",
    body: (
      <ul>
        <li><strong>계정</strong>: 이메일, 이름(표시 이름), 암호화된 비밀번호</li>
        <li><strong>사업 정보</strong>: 상호, 업종, 지역, 홈페이지·SNS 주소, 마케팅 프로필 등 이용자가 입력하거나 확인한 내용</li>
        <li><strong>서비스 이용 기록</strong>: 진단 결과, 캘린더, 생성한 블로그 글·숏폼, 이용 횟수, 접속·오류 로그</li>
        <li><strong>외부 서비스 연결</strong>: 이용자가 직접 연결한 경우의 접근 토큰(암호화 저장소에 보관하며 화면에 다시 보여주지 않아요)</li>
        <li><strong>결제</strong>: 주문 번호, 요금제, 결제 상태. 카드 번호는 결제대행사가 처리하며 서비스는 저장하지 않아요.</li>
      </ul>
    ),
  },
  {
    title: "이용 목적",
    body: (
      <ul>
        <li>회원 식별과 로그인, 비밀번호 재설정 메일 발송</li>
        <li>마케팅 진단, 캘린더·콘텐츠 생성 등 요청한 기능 제공</li>
        <li>요금제 이용 한도 관리, 결제 기록 확인, 문의 응대</li>
        <li>오류 분석과 부정 이용 방지</li>
      </ul>
    ),
  },
  {
    title: "보관 기간과 파기",
    body: (
      <>
        <p>계정을 삭제하면 관련 정보는 지체 없이 파기해요. 학교 프로젝트 기간이 끝나 서비스를 종료할 때도 모든 이용자 데이터를 삭제해요.</p>
        <p>보안 사고 대응을 위한 접속·오류 로그는 최대 30일간 보관할 수 있어요.</p>
      </>
    ),
  },
  {
    title: "처리 위탁과 국외 이전",
    body: (
      <>
        <p>서비스 제공을 위해 아래 업체에 처리를 맡기며, 일부는 해외 서버에서 처리될 수 있어요.</p>
        <ul>
          <li>Supabase — 데이터베이스, 로그인, 파일 저장</li>
          <li>Vercel — 웹 서비스 호스팅</li>
          <li>AI 모델 제공사(Anthropic, OpenAI, Google 중 운영 설정에 따른 곳) — 진단 설명과 콘텐츠 생성 요청 처리. 사업 정보와 요청 내용이 전달되며, 계정 비밀번호는 전달되지 않아요.</li>
          <li>JSON2Video — 숏폼 영상 렌더링</li>
          <li>토스페이먼츠 — 결제 처리(테스트 모드)</li>
          <li>Google(YouTube Data API), 네이버(검색 API) — 이용자가 입력한 공개 채널·블로그 정보 조회</li>
        </ul>
      </>
    ),
  },
  {
    title: "쿠키",
    body: <p>로그인 상태 유지와 보안을 위한 필수 쿠키만 사용해요. 광고·추적 목적의 쿠키는 사용하지 않아요.</p>,
  },
  {
    title: "이용자의 권리",
    body: (
      <ul>
        <li>프로필과 사업 정보는 설정·사업 정보 화면에서 언제든 확인하고 고칠 수 있어요.</li>
        <li>개인정보 열람, 정정, 삭제, 처리 정지와 계정 삭제는 로그인 후 &lsquo;문의&rsquo; 메뉴로 요청해주세요. 확인 후 지체 없이 처리해드려요.</li>
      </ul>
    ),
  },
  {
    title: "안전성 확보 조치",
    body: <p>모든 통신은 HTTPS로 암호화하고, 데이터베이스는 이용자별 접근 제어(행 단위 보안)를 적용해요. 외부 서비스 토큰은 별도의 암호화 저장소에 보관해요.</p>,
  },
  {
    title: "방침의 변경",
    body: <p>이 방침을 바꿀 때는 시행 전에 서비스 화면에 알려드려요.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="개인정보처리방침"
      effectiveDate="2026년 10월 10일"
      intro={<p>Easy Marketing은 <strong>학교 프로젝트 데모 서비스</strong>로, 서비스 제공에 필요한 최소한의 정보만 수집하고 프로젝트가 끝나면 모두 삭제해요.</p>}
      sections={SECTIONS}
    />
  );
}
