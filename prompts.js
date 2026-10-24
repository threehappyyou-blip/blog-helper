/* 블로그 도우미 공용 프롬프트 — 사이트와 GitHub 서버가 같이 씁니다 */
(function(root){
'use strict';
const ANGLES=['신청방법','대상·자격','지급일·금액','사용처·사용기한','자주 묻는 질문','놓치기 쉬운 주의사항'];
const PRICES={
  'claude-sonnet-5-5':{in:2,cw:2.5,cr:0.1,out:10,name:'Sonnet 5.5'},
  'claude-haiku-5-5':{in:0.1,cw:0.125,cr:0.01,out:0.5,name:'Haiku 5.5'},
  'claude-opus-5-5':{in:4,cw:5,cr:0.2,out:20,name:'Opus 5.5'}
};
const SEARCH_USD=0.01;
// 호출 1번의 실제 비용(USD). 모르는 모델은 Opus 가격으로 넉넉히 잡는다
function costOf(model,u){
  if(!u)return 0;const p=PRICES[model]||PRICES['claude-opus-5-5'];
  const inT=u.input_tokens||0,cw=u.cache_creation_input_tokens||0,cr=u.cache_read_input_tokens||0,out=u.output_tokens||0;
  const big=model==='claude-haiku-5-5'&&inT+cw+cr>100000?5:1; // Haiku는 10만 토큰 넘는 요청이 5배
  const srch=(u.server_tool_use&&u.server_tool_use.web_search_requests)||0;
  return (inT*p.in+cw*p.cw+cr*p.cr+out*p.out)*big/1e6+srch*SEARCH_USD;
}
// 버튼 옆 예상 비용 (보수적으로)
function estimate(kind,models){
  const m=models||{};
  const call=(model,inT,out,srch)=>costOf(model,{input_tokens:inT,output_tokens:out,server_tool_use:{web_search_requests:srch}});
  if(kind==='keywords')return call(m.kw,25000,2500,4);
  if(kind==='research')return call(m.research,35000,3500,4);
  if(kind==='write')return call(m.write,6000,6000,0);
  if(kind==='series')return costOf(m.write,{input_tokens:1500,cache_read_input_tokens:4000,output_tokens:6000});
  if(kind==='post')return estimate('research',m)+estimate('write',m);
  return 0;
}
function todayKST(){const d=new Date(Date.now()+9*3600e3);return d.toISOString().slice(0,10)}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function extractJSON(t){
  const tags=[...t.matchAll(/<json>([\s\S]*?)<\/json>/g)];
  let s=tags.length?tags[tags.length-1][1]:t;
  s=s.replace(/```(?:json)?/g,'');
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a<0||b<a)throw new Error('결과를 읽지 못했습니다. 다시 시도해 주세요.');
  return JSON.parse(s.slice(a,b+1));
}
function parseSec(t){
  const out={}; const re=/^@@([A-Z]+)\s*$/gm; let m,marks=[];
  while((m=re.exec(t)))marks.push({k:m[1],s:m.index,e:re.lastIndex});
  marks.forEach((mk,i)=>{out[mk.k]=t.slice(mk.e,i+1<marks.length?marks[i+1].s:t.length).trim()});
  return out;
}
function compact(r){
  r=r||{};const c=r.competitors||{};
  const o={deadline_warning:r.deadline_warning||undefined,facts:(r.facts||[]).slice(0,25).map(f=>({item:f.item,value:f.value,confirmed:f.confirmed===false?false:undefined,source:f.source})),
    procedures:(r.procedures||[]).slice(0,3),missing_in_competitors:(c.missing||[]).slice(0,6),errors_in_competitors:(c.errors||[]).slice(0,4),
    sources:(r.sources||[]).slice(0,6).map(x=>({title:String(x.title||'').slice(0,80),url:x.url}))};
  let t=JSON.stringify(o);
  if(t.length>12000){o.procedures=o.procedures.slice(0,1);t=JSON.stringify(o).slice(0,12000)}
  return t;
}
function create(settings){
  const S={settings:settings||{}};
const BANNED='"~에 대해 알아보겠습니다", "살펴보겠습니다", "오늘은 ~에 대해", "결론적으로", "다양한", "누구나", "무조건", "역대급", "또 준다", "도움이 되셨길 바랍니다", "꼭 참고하세요", "여러분", 이모지';
function pKeywords(exclude){
  exclude=(exclude||[]).filter(Boolean).slice(-150);
  const sys=`너는 한국 네이버 블로그 운영자를 돕는 키워드 리서처다. 오늘은 ${todayKST()} (한국 시간)이다.
웹 검색으로 최근 48시간 이내 한국의 뉴스, 정부·지자체 공고, 정책 발표, 생활 이슈를 확인하고, 한국 사람들이 네이버에서 곧 많이 검색할 키워드를 찾는다.
제외할 키워드:
- 고객센터 전화번호처럼 검색 결과나 AI 브리핑에서 답이 바로 나오는 것
- 확정 발표가 없는 루머성 정보, 아직 발표 안 된 금액을 추정해야 하는 것
- 의료·투자 판단을 대신해 주는 주제, 정치 성향이 드러나는 주제, 사건·사고 피해자 관련 주제
후보는 10개. 서로 다른 주제여야 한다 — 같은 제도·사건을 단어만 바꾼 변형(예: "○○ 신청방법"과 "○○ 신청기간")은 1개로 친다. 분야도 고루 섞는다.
후보 중 최소 2개는 "${S.settings.interest||'생활 실무'}" 분야처럼 생활 경험을 쓰기 쉬운 장기형 키워드로 넣는다.
${exclude.length?`이미 글을 쓴 키워드라 제외할 것(같은 주제의 변형도 제외): ${exclude.join(', ')}
`:''}wordpress_fit: 구글 검색으로 오래 찾을 정리형 주제면 true (보통 장기형).
opportunity: 1~5. 검색 수요는 큰데 상위 글이 부실하거나 적을수록 높게. 공식 출처가 있어 정확하게 쓸 수 있으면 +1.
각 키워드는 사람들이 실제로 검색창에 칠 법한 2~4단어 형태로 쓴다.
검색은 4회 이내로 한다(정책·지원금 뉴스, 생활 이슈, 정부 공고 등 넓게 한 번씩). reason은 짧게 한 문장. JSON 앞뒤에 설명 문장을 쓰지 않는다.
category는 다음 목록 중 하나: ${S.settings.categories}
결과는 <json>...</json> 태그 안에 JSON 하나로만 낸다. 태그 밖에는 아무것도 쓰지 않는다.
형식: {"keywords":[{"keyword":"","reason":"지금 뜨는 이유 한 문장","type":"이슈형 또는 장기형","lifespan":"예상 유효기간","official_source":true,"competition":"낮음/보통/높음","category":"","wordpress_fit":false,"opportunity":3}]}`;
  return {sys,user:'오늘 기준 서로 다른 키워드 후보 10개를 찾아줘.'};
}
function pResearch(kw){
  const sys=`너는 네이버 블로그 글을 준비하는 리서처다. 오늘은 ${todayKST()} (한국 시간)이다.
메인 키워드: "${kw}"
할 일:
1) 1차 출처(정부24, 정부·지자체 공고문, 정부 보도자료, 기관 공식 홈페이지)에서 날짜·금액·대상·신청기간·신청방법·사용처 등 핵심 사실을 찾는다. 확정되지 않은 정보는 confirmed:false로 두고 추정치를 만들지 않는다.
2) 이 키워드로 상위에 노출되는 블로그·뉴스 글 1~3개를 찾아 공통점, 모두 빠뜨린 정보, 틀리거나 오래된 정보를 정리한다.
3) 글 7개를 계획한다: 네이버 블로그용 6개 + 워드프레스용 1개.
 - 모든 글의 sub_keyword는 메인 키워드 "${kw}"를 글자 그대로(띄어쓰기 포함) 포함해야 한다.
 - 네이버 6개는 각도가 서로 겹치면 안 된다. 참고 각도: ${ANGLES.join(' / ')}. 키워드 성격에 맞게 바꿔도 되지만 같은 내용을 다른 말로 반복하는 계획은 금지.
 - 워드프레스 1개는 전체를 비교표와 FAQ 중심으로 정리하는 종합 가이드 각도로, 네이버 글과 구성이 달라야 한다.
 - category는 다음 목록 중 하나: ${S.settings.categories}. 맞는 게 없으면 가장 가까운 것을 고르고 category_note에 이유를 적는다.
 - publish_day: 네이버 글을 하루 1~2개씩 나눠 올리도록 1부터 번호를 매긴다. 가장 수요가 큰 글을 1일차에 둔다. 워드프레스는 1.
4) 신청 기간이 이미 끝났거나 7일 안에 끝나면 deadline_warning에 적는다. 아니면 빈 문자열.
5) 따라하기 절차를 수집한다. 신청·조회·사용 등 사람이 직접 해야 하는 일이 있으면, 공식 안내문·이용 가이드·FAQ에서 실제 화면 순서를 찾아 procedures에 정리한다.
 - channel: "온라인(사이트 이름)", "앱(앱 이름)", "방문" 등 경로별로 나눈다.
 - 단계마다: 접속할 곳(URL·앱 이름), 누를 메뉴·버튼의 정확한 이름, 입력하거나 고를 항목, 준비물, 완료 후 나오는 화면·문구.
 - 메뉴·버튼 이름을 출처에서 직접 확인했으면 verified:true, 출처에 정확한 이름이 없으면 verified:false. 이름을 추측해서 채우지 않는다.
 - 절차가 필요 없는 키워드면 빈 배열.
결과는 <json>...</json> 태그 안에 JSON 하나로만 낸다. 태그 밖에는 아무것도 쓰지 않는다.
형식: {"deadline_warning":"","facts":[{"item":"","value":"","source":"URL","confirmed":true}],"procedures":[{"channel":"","url":"","need":["준비물"],"steps":[{"where":"","action":"","input":"","result":"","verified":true}],"source":"URL"}],"sources":[{"title":"","url":""}],"competitors":{"common":[""],"missing":[""],"errors":[""]},"posts":[{"platform":"naver 또는 wordpress","sub_keyword":"","angle":"이 글이 다룰 내용 한 문장","category":"","category_note":"","publish_day":1}]}`;
  return {sys,user:`"${kw}" 리서치와 글 7개 계획을 만들어줘.`};
}
function pResearchOne(kw,platform){
  const wp=platform==='wordpress';
  const sys=`너는 ${wp?'워드프레스(구글 검색용)':'네이버 블로그'} 글 1개를 준비하는 리서처다. 오늘은 ${todayKST()} (한국 시간)이다.
키워드: "${kw}"
할 일:
1) 1차 출처(정부24, 정부·지자체 공고문, 정부 보도자료, 기관 공식 홈페이지)에서 날짜·금액·대상·신청기간·신청방법·사용처 등 핵심 사실을 찾는다. 확정되지 않은 정보는 confirmed:false로 두고 추정치를 만들지 않는다.
2) 이 키워드로 상위에 노출되는 블로그·뉴스 글 1~3개를 찾아 공통점, 모두 빠뜨린 정보, 틀리거나 오래된 정보를 정리한다.
검색은 최대 4회(1차 출처 2회, 상위글 2회). 같은 내용을 반복 검색하지 않는다.
답은 짧게: JSON 앞뒤에 설명 문장을 쓰지 않는다. facts는 15개 이하, 각 value는 한 줄. procedures는 경로 2개 이하·단계 8개 이하. competitors의 각 목록은 5개 이하, 한 줄씩. sources는 6개 이하. series는 5개 이하.
3) 이 키워드로 쓸 글 1개의 방향(plan)을 정한다: 검색하는 사람이 가장 알고 싶은 것을 중심으로, 상위글이 빠뜨린 정보를 차별점으로. ${wp?'워드프레스 글은 비교표와 FAQ 중심 정리형.':''}
 - category는 다음 목록 중 하나: ${S.settings.categories}. 맞는 게 없으면 가장 가까운 것을 고르고 category_note에 이유를 적는다.
6) 이 글 다음에 같은 키워드로 이어 쓸 시리즈 편 4~5개를 series에 제안한다. 첫 글(plan)과도, 서로도 겹치지 않게, 위 조사 자료만으로 쓸 수 있는 주제로. sub_keyword는 키워드를 글자 그대로 포함.
4) 신청 기간이 이미 끝났거나 7일 안에 끝나면 deadline_warning에 적는다. 아니면 빈 문자열.
5) 따라하기 절차를 수집한다. 신청·조회·사용 등 사람이 직접 해야 하는 일이 있으면, 공식 안내문·이용 가이드·FAQ에서 실제 화면 순서를 찾아 procedures에 정리한다.
 - channel: "온라인(사이트 이름)", "앱(앱 이름)", "방문" 등 경로별로 나눈다.
 - 단계마다: 접속할 곳(URL·앱 이름), 누를 메뉴·버튼의 정확한 이름, 입력하거나 고를 항목, 완료 후 나오는 화면·문구.
 - 메뉴·버튼 이름을 출처에서 직접 확인했으면 verified:true, 아니면 verified:false. 이름을 추측해서 채우지 않는다.
 - 절차가 필요 없는 키워드면 빈 배열.
결과는 <json>...</json> 태그 안에 JSON 하나로만 낸다. 태그 밖에는 아무것도 쓰지 않는다.
형식: {"deadline_warning":"","facts":[{"item":"","value":"","source":"URL","confirmed":true}],"procedures":[{"channel":"","url":"","need":["준비물"],"steps":[{"where":"","action":"","input":"","result":"","verified":true}],"source":"URL"}],"sources":[{"title":"","url":""}],"competitors":{"common":[""],"missing":[""],"errors":[""]},"plan":{"angle":"이 글이 다룰 내용 한 문장","category":"","category_note":""},"series":[{"sub_keyword":"","angle":""}]}`;
  return {sys,user:`"${kw}" 리서치와 글 방향을 정리해줘.`};
}
function researchOf(pr,post){
  if(post.research)return post.research;
  if(post.researchFrom){const src=(pr.posts||[]).find(x=>x.id===post.researchFrom);if(src&&src.research)return src.research}
  return pr.research||{};
}
function pWrite(pr,post){
  const sp=post.spec, wp=sp.platform==='wordpress', detail=S.settings.detail!==false;
  const r=researchOf(pr,post);
  const KW=post.kw||pr.keyword, multi=!!post.kw;
  const root=post.researchFrom||post.id;
  const sibs=(pr.posts||[]).filter(x=>x!==post&&(multi?(x.id===root||x.researchFrom===root):true));
  const showSub=sp.sub_keyword&&sp.sub_keyword!==KW;
  // 1) 공통 부분 — 같은 리서치를 쓰는 시리즈 글끼리 똑같아서 캐시로 싸게 재사용된다
  const common=`너는 한국어 블로그 글 작가다. 사람이 직접 쓴 것처럼 자연스럽고 구체적으로 쓴다. 오늘은 ${todayKST()}이다.
[조사 자료]
${compact(r)}

공통 규칙:
[제목] 아래 [메인 키워드]를 글자 그대로 맨 앞에 두고, 뒤에는 궁금증을 만드는 한 구절을 붙인다.
- 궁금증 = 답의 일부만 보여주고 나머지는 본문에 있다는 느낌. 예: "○○ 신청, 이것 하나 빠뜨려서 탈락해요", "○○ 받았는데 왜 금액이 다를까?", "○○ 12월 31일 지나면 생기는 일"
- 숫자·대상·마감 중 하나를 꼭 넣는다(조사 자료로 사실인 것만). 숫자는 정확히, 결론은 제목에서 다 말하지 않는다.
- 금지: 사실이 아닌 약속, "무조건/누구나/역대급/충격/소름", 느낌표 2개 이상, 키워드 2번 반복.

[문체 — 사람이 쓴 것처럼]
- 친근한 해요체. 어미를 섞는다(~해요/~거든요/~더라고요/~죠/~이에요). 같은 어미가 3문장 연속 나오지 않게.
- 문장 길이를 섞는다(짧은 문장과 긴 문장). 한 문장 60자 이내를 기본으로.
- 정보 사이사이 실전 코멘트 1문장씩: "여기서 많이들 헷갈려요", "저라면 이것부터 확인할 것 같아요"(경험을 지어내지는 않는다).
- 금지 표현: ${BANNED}. "~하는 것이 좋습니다/중요합니다"는 글 전체에 2번 이하.
- 같은 문장 틀을 반복하지 않는다(모든 소제목을 같은 패턴으로 시작하지 않기).

[구성 — 검색·AI 브리핑 노출]
- 첫 1~2문장: 독자 상황에 공감하는 도입("난방비 고지서 보고 놀라셨죠?")에 [메인 키워드]를 넣는다.
- 이어서 "> 한눈에 보기" 블록: 첫 줄 "> 한눈에 보기", 다음 3~4줄 "> - 누가: …" 형식(누가·얼마·언제까지·어디서). 숫자·날짜는 단위와 함께.
- 그다음 문단 150자 안에 핵심 답과 "${todayKST().replace(/^(\d+)-(\d+)-(\d+)$/,(m,y,mo,d)=>y+'년 '+(+mo)+'월 '+(+d)+'일')} 기준"을 쓴다.
- 소제목 4~6개(##). 2개 이상은 사람들이 실제로 검색하는 질문형("○○은 어디서 신청하나요?"). 1~2개에 [메인 키워드].
- AI가 그대로 인용하기 좋은 문장 3종을 본문에 꼭 넣는다:
  ① 정의 문장: "[메인 키워드 또는 제도명]은(는) ~하는 제도예요." — 주어를 생략하지 않은, 혼자 읽어도 뜻이 통하는 한 문장. 첫 질문형 소제목 바로 아래 첫 문장으로.
  ② 방법 한 문장: "○○(사이트·앱)에서 ○○을 누르면 신청할 수 있어요."처럼 방법을 한 문장으로.
  ③ 괄호 구체 정보: 금액·기간·대상은 "(1인 295,200원)", "(11월 1일~12월 31일)"처럼 괄호로 정확히.
- 질문형 소제목 아래 첫 문장은 "그것은/이것은"으로 시작하지 말고 대상 이름으로 시작해 바로 답한다.
- 공식 명칭은 처음 나올 때 그대로(예: 국세청 홈택스), 같은 대상을 여러 이름으로 부르지 않는다.
- 표 1개 이상, 절차는 번호 목록, 한 문단 3줄 이내.
- 조사 자료 missing_in_competitors(상위글이 모두 빠뜨린 정보)를 담은 섹션 최소 1개, errors_in_competitors가 있으면 바르게 짚는다.

[정확성 — 저품질 방지]
- 사실은 조사 자료에 있는 것만. confirmed:false는 "아직 확정되지 않았어요"라고 쓴다. 숫자·날짜를 지어내지 않는다.
- 다른 글·뉴스 문장을 베끼지 말고 직접 풀어 쓴다. 키워드를 억지로 반복하지 않는다.
${detail?`- 따라하기 섹션 (아주 자세히): 이 글 각도와 관련해 독자가 직접 해야 하는 일(신청·조회·사용·확인 등)이 있으면 "## ○○ 따라하기" 소제목을 만들고, 컴퓨터를 잘 모르는 60대도 그대로 따라 할 수 있게 쓴다.
  · 시작 전에 "준비물" 목록(신분증, 공동·간편인증서, 계좌 등)과 "걸리는 시간"을 먼저 적는다.
  · 단계마다 "### 1단계. (한 줄 요약)" 소제목을 달고, 그 아래를 이 순서로 쓴다:
    ① 어디서: 접속할 사이트 주소 또는 앱 이름, 휴대폰인지 PC인지
    ② 무엇을 누르나: 버튼·메뉴 이름을 **"버튼 이름"**처럼 굵은 따옴표로, 화면 어디쯤 있는지(오른쪽 위, 화면 가운데, 맨 아래 등)
    ③ 무엇을 입력·선택하나: 칸 이름과 넣을 내용(예: "주민등록번호 앞자리 6자리")
    ④ 화면을 아래로 내려야 하면 "화면을 아래로 내리면 ○○이 보입니다"처럼 적는다
    ⑤ 다음 버튼: 마지막에 누를 버튼(**"다음"**, **"신청하기"**, **"저장"** 등)
    ⑥ 성공 확인: 이 단계가 끝나면 어떤 화면·문구가 뜨는지
    ⑦ 단계마다 바로 아래에 [사진 넣기: N단계 ○○ 화면 캡처]를 넣는다
  · 조사 자료 procedures에서 verified:true인 메뉴·버튼 이름만 확정적으로 쓴다. verified:false이거나 자료에 없는 이름은 일반적인 표현으로 쓰고 바로 뒤에 [확인 필요: 실제 화면에서 버튼 이름 확인]을 붙인다. 버튼 이름을 지어내지 않는다.
  · 따라하기 끝에 "자주 막히는 부분" 3개 안팎(증상 → 해결)을 넣는다.
  · 이 글 각도에 직접 해야 하는 일이 없으면 따라하기 섹션은 넣지 않는다. 다른 글의 따라하기와 같은 절차를 반복하지 않는다.
`:''}- [사진 넣기: 무엇을] 자리를 ${detail?'따라하기 단계마다 + 그 밖에 1~2곳':'2~3곳'}, [경험 넣기: 어떤 경험] 자리를 2곳 본문 흐름에 맞게 넣는다. 경험 내용은 지어내지 않고 자리만 표시한다.
- [같은 시리즈의 다른 글]이 주어지면: 그 글들이 다루는 내용은 한두 줄로만 언급하고 이 글의 방향에 집중한다. 출처 바로 앞에 "## 함께 보면 좋은 글" 소제목을 두고 다른 글마다 "- 글 제목 [링크 넣기: 글 제목]" 한 줄씩 쓴다.
- 끝부분 순서: "## 자주 묻는 질문" (질문 3~5개, "### 질문" 아래 답은 대상 이름으로 시작하는 1~2문장) → "## 출처" 1차 출처 링크 목록(마크다운 링크) → 3줄 요약 → 댓글을 유도하는 질문 1줄.

출력 형식 (이 순서, 표시줄 그대로, 다른 말 없이):
@@TITLE
제목 한 줄
@@TAGS
태그 10개, 쉼표로 구분, # 없이
@@BODY
본문 (마크다운)
@@PHOTOS
본문의 [사진 넣기] 자리마다 한 줄: - 캡처할 화면 | 여는 곳(사이트·앱 이름과 메뉴 경로) | 가릴 개인정보
@@CARDS
카드 이미지용 짧은 문구 3줄, 정확히 이 형식:
정의 | 카드 제목(15자 이내) | 정의 한 문장(40자 이내)
요약 | 카드 제목(15자 이내) | 항목: 값 ; 항목: 값 ; 항목: 값 (3~4개, 각 25자 이내)
단계 | 카드 제목(15자 이내) | 1단계 ; 2단계 ; 3단계 (3~5개, 각 20자 이내)
@@EXPERIENCE
본문의 [경험 넣기] 자리마다: 자리 이름 한 줄, 그 아래 예시 문장 2개(- 로 시작). 직접 신청하지 않아도 쓸 수 있는 "확인한 경험" 형태.
@@CHECK
- 항목 | 본문에 쓴 값 | ✅ 출처와 일치 또는 ⚠️ 확인 필요
(본문의 [확인 필요] 버튼·메뉴 이름도 ⚠️ 항목으로 모두 넣는다)
@@META
검색 결과에 보일 설명 한 줄, 80~150자, [메인 키워드] 포함
@@SLUG
워드프레스 글 주소용 영어 소문자-하이픈 3~6단어 (네이버 글이면 빈 줄)
@@TITLES
위 [제목] 규칙을 지킨 다른 후보 3개, 한 줄에 하나. 각각 다른 궁금증 방식(질문형 / 놓치면 손해형 / 숫자·대상형).`;
  // 2) 이 글 전용 부분
  const spec=`[플랫폼] ${wp?'워드프레스(구글 검색 유입용)':'네이버 블로그'}
[메인 키워드] ${KW}
${showSub?`[이 글의 세부 키워드] ${sp.sub_keyword}\n`:''}[이 글의 방향] ${sp.angle||'검색하는 사람이 가장 알고 싶은 것 중심'}
[카테고리] ${sp.category}
${sibs.length?`[같은 시리즈의 다른 글 — 내용이 겹치지 않게]\n${sibs.map(x=>'- '+(x.title||x.spec.sub_keyword)+': '+(x.spec.angle||'')).join('\n')}\n`:''}이 글의 규칙:
- 제목 ${wp?'40자 안팎':'30자 안팎'}.
- 본문에 [메인 키워드] ${wp?'4~6':'3~5'}회.
${wp?'- FAQ 소제목 아래 질문 3~5개와 답을 넣는다. 비교표를 중심에 둔다.\n':''}- 분량: ${wp?'2,500~3,500자':'1,500~2,500자'}${detail?' (따라하기 섹션이 있으면 그만큼 더 길어져도 된다)':''}.`;
  const useCache=!!post.researchFrom||(pr.posts||[]).some(x=>x.researchFrom===post.id&&x.status!=='done');
  return {sys:[Object.assign({type:'text',text:common},useCache?{cache_control:{type:'ephemeral'}}:{}),{type:'text',text:spec}],user:`위 규칙대로 "${showSub?sp.sub_keyword:KW}" 글을 써줘.`};
}
function pSeries(pr,post){
  const r=researchOf(pr,post), KW=post.kw||pr.keyword;
  const have=(pr.posts||[]).filter(x=>x.id===post.id||x.researchFrom===post.id).map(x=>'- '+(x.title||x.spec.sub_keyword)+': '+(x.spec.angle||'')).join('\n');
  const sys=`너는 네이버 블로그 시리즈 기획자다. 웹 검색 없이 아래 조사 자료만 보고 정한다.
키워드: "${KW}"
이미 쓴 글:
${have}
[조사 자료]
${compact(r)}
같은 키워드로 이어서 쓸 시리즈 편 5개를 제안한다. 이미 쓴 글과도, 서로도 내용이 겹치지 않게. 조사 자료로 쓸 수 있는 내용만.
sub_keyword는 "${KW}"를 글자 그대로 포함하고 사람들이 실제로 검색할 형태로.
결과는 <json>...</json> 안에 JSON 하나로만: {"series":[{"sub_keyword":"","angle":"이 편이 다룰 내용 한 문장"}]}`;
  return {sys,user:'시리즈 편 5개를 제안해줘.'};
}

function buildPosts(kw,plan){
  plan=Array.isArray(plan)?plan:[];
  let nav=plan.filter(x=>x&&x.platform!=='wordpress').slice(0,6);
  let wp=plan.find(x=>x&&x.platform==='wordpress');
  const usedAngles=nav.map(x=>x.sub_keyword||'');
  for(const a of ANGLES){ if(nav.length>=6)break; if(!usedAngles.some(u=>u.includes(a.split('·')[0])))nav.push({platform:'naver',sub_keyword:`${kw} ${a}`,angle:`${a} 중심으로 정리`,category:'',publish_day:nav.length+1}); }
  if(!wp)wp={platform:'wordpress',sub_keyword:`${kw} 총정리`,angle:'비교표와 FAQ 중심 종합 가이드',category:'',publish_day:1};
  const fix=(s,i)=>{const sp=Object.assign({},s);if(!(sp.sub_keyword||'').includes(kw))sp.sub_keyword=`${kw} ${sp.sub_keyword||''}`.trim();sp.category=sp.category||S.settings.categories.split(',')[0].trim();sp.publish_day=sp.publish_day||i+1;return sp};
  return [...nav.map((s,i)=>({spec:fix(Object.assign(s,{platform:'naver'}),i),status:'wait'})),{spec:fix(Object.assign(wp,{platform:'wordpress'}),0),status:'wait'}]
    .map((x,i)=>Object.assign(x,{id:uid(),no:i+1,raw:'',title:'',published:false}));
}
function buildMulti(items){
  const cat0=String(S.settings.categories||'').split(',')[0].trim();
  let nd=0;
  return items.map((it,i)=>{const wp=it.platform==='wordpress';if(!wp)nd++;
    return {id:uid(),no:i+1,kw:it.keyword,research:null,status:'wait',raw:'',title:'',published:false,
      spec:{platform:wp?'wordpress':'naver',sub_keyword:it.keyword,angle:'',category:it.category||cat0,publish_day:wp?1:Math.ceil(nd/2),type:it.type||''}}});
}
function buildSeries(pr,src,items){
  const sibs=(pr.posts||[]).filter(x=>x.id===src.id||x.researchFrom===src.id).length;
  return items.map((it,i)=>{const kw=src.kw||pr.keyword;let sub=String(it.sub_keyword||'').trim()||kw;if(!sub.includes(kw))sub=(kw+' '+sub).trim();
    return {id:uid(),no:(pr.posts||[]).length+i+1,kw,researchFrom:src.id,series:true,status:'wait',raw:'',title:'',published:false,
      spec:{platform:'naver',sub_keyword:sub,angle:it.angle||'',category:src.spec.category,publish_day:sibs+i+1}}});
}
function applyPlan(post,r){
  const pl=(r&&r.plan)||{};
  post.research=r;post.spec.angle=pl.angle||post.spec.angle;
  if(pl.category)post.spec.category=pl.category;post.spec.category_note=pl.category_note||'';
}
  return {pKeywords,pResearch,pResearchOne,pWrite,pSeries,buildPosts,buildMulti,buildSeries,applyPlan,researchOf};
}
root.BH={create,extractJSON,parseSec,todayKST,uid,ANGLES,PRICES,SEARCH_USD,costOf,estimate,version:11};
})(typeof globalThis!=='undefined'?globalThis:this);
