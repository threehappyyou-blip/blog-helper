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
  if(kind==='patterns')return call(m.research,60000,4000,6);
  if(kind==='research')return call(m.research,35000,3500,4);
  if(kind==='write')return call(m.write,6000,9000,0);
  if(kind==='series')return costOf(m.write,{input_tokens:1500,cache_read_input_tokens:4000,output_tokens:9000});
  if(kind==='post')return estimate('research',m)+estimate('write',m);
  if(kind==='auto')return (estimate('research',m)+call(m.write,7000,9000,0))*1.1; // 구글용 긴 글 + 가끔 고쳐쓰기
  if(kind==='autoLite')return (call(m.research,15000,2000,1)+call(m.write,7000,9000,0))*1.1; // 네이버 리서치 재사용 + 구글 상위 글 가볍게 확인
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
[블로그 주제 — 반드시 이 안에서만] ${S.settings.topic||'부업, 돈 아끼는 방법'}
네이버는 한 분야에 집중한 블로그를 전문가로 보고 AI 브리핑에 더 자주 인용한다. 그래서 키워드는 모두 위 주제 안에서만 고른다. 지원금·환급·할인·세금 등은 "돈을 아끼거나 받는 방법" 관점일 때만 포함한다.
키워드는 두 종류로 찾는다.
- 장기형(우선): 1년 이상 매달·매년 꾸준히 검색되는 생활 질문형 키워드. 예) "~하는 법", "~ 조건", "~ 비교", "~ 아끼는 방법", 매년 돌아오는 제도·시즌(연말정산, 자동차세 연납, 종합소득세 신고 등). 검색 수요가 큰 대표 표현을 고르고, 너무 좁아서 아무도 안 칠 표현은 피한다.
- 이슈형: 웹 검색으로 최근 48시간 이내 뉴스·정부 발표·생활 이슈를 확인해서 곧 많이 검색될 키워드.
제외할 키워드:
- 고객센터 전화번호처럼 검색 결과나 AI 브리핑에서 답이 바로 나오는 것
- 확정 발표가 없는 루머성 정보, 아직 발표 안 된 금액을 추정해야 하는 것
- 의료·투자 판단을 대신해 주는 주제(주식·코인 종목 추천 등), 정치 성향이 드러나는 주제, 사건·사고 피해자 관련 주제
- 블로그 주제와 관계없는 키워드
- 수익을 보장하는 부업, 다단계·불법·사기 의심 부업, 앱테크 과장("하루 10만원")처럼 독자에게 손해를 줄 수 있는 주제
후보는 20개 — 그중 장기형 최소 15개, 이슈형 최대 5개. 월 검색량이 100회도 안 될 만큼 좁은 표현은 내지 않는다(검색량이 적은 후보는 자동으로 빠진다). 서로 다른 키워드여야 한다 — 같은 제도·사건을 단어만 바꾼 변형(예: "○○ 신청방법"과 "○○ 신청기간")은 1개로 친다. 블로그 주제 안에서 세부 분야(부업, 생활비 절약, 지원금·환급, 할인·혜택 등)를 고루 섞는다.
장기형 중 몇 개는 "${S.settings.interest||'생활 실무'}" 분야처럼 생활 경험을 쓰기 쉬운 것으로 넣는다.
${exclude.length?`이미 글을 쓴 키워드라 절대 다시 내지 말 것(같은 주제의 변형도 제외): ${exclude.join(', ')}
`:''}platform: 어디에 쓰기 좋은지 — 생활 경험·후기·지역·시즌·이슈형이라 네이버 사용자에게 맞으면 "naver", 1년 이상 검색되는 정리형(비교·기준·방법·체크리스트·계산)이라 구글 검색에 맞으면 "google". 한쪽으로 몰리지 않게 실제 성격대로.
briefing: 네이버 AI 브리핑(검색 결과 위 AI 요약)이 뜨고 블로그 글을 인용할 가능성 — 원인·이유·정의·조건·기간 같은 정보형이면 "높음", 방법·절차형이면 "보통", 추천·비교·가격·순위 같은 상업형이나 건강·의료·투자처럼 민감한 주제, 사람마다 답이 다른 질문이면 "낮음". briefing이 낮음이면 platform은 google로 둔다.
wordpress_fit: platform이 google이면 true.
opportunity: 1~5. 검색 수요는 큰데 상위 글이 부실하거나 적을수록 높게. 공식 출처가 있어 정확하게 쓸 수 있으면 +1. 장기형이면서 검색 수요가 크면 높게.
각 키워드는 사람들이 실제로 검색창에 칠 법한 2~4단어 형태로 쓴다.
검색은 4회 이내로 한다(이슈 확인 2회, 사람들이 꾸준히 묻는 질문 확인 2회). reason은 짧게 한 문장. JSON 앞뒤에 설명 문장을 쓰지 않는다.
category는 다음 목록 중 하나: ${S.settings.categories}
결과는 <json>...</json> 태그 안에 JSON 하나로만 낸다. 태그 밖에는 아무것도 쓰지 않는다.
형식: {"keywords":[{"keyword":"","reason":"지금 뜨는 이유 한 문장","type":"이슈형 또는 장기형","lifespan":"예상 유효기간","official_source":true,"competition":"낮음/보통/높음","category":"","platform":"naver 또는 google","briefing":"높음/보통/낮음","wordpress_fit":false,"opportunity":3}]}`;
  return {sys,user:'오늘 기준 서로 다른 키워드 후보 20개를 찾아줘. 검색량 많은 장기형 위주로.'};
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
주소(URL)는 검색 결과에 나온 주소를 글자 하나 바꾸지 않고 그대로 적는다. 주소를 추측하거나 조합해서 만들지 않는다. 검색 결과 목록 페이지, 로그인·세션이 붙은 주소(jsessionid, token 등)는 피하고, 기관의 공식 안내 페이지를 고른다.
답은 짧게: JSON 앞뒤에 설명 문장을 쓰지 않는다. facts는 15개 이하, 각 value는 한 줄. procedures는 경로 2개 이하·단계 8개 이하. competitors의 각 목록은 5개 이하, 한 줄씩. sources는 6개 이하. series는 5개 이하.
3) 이 키워드로 쓸 글 1개의 방향(plan)을 정한다: 검색하는 사람이 가장 알고 싶은 것을 중심으로, 상위글이 빠뜨린 정보를 차별점으로. ${wp?'워드프레스 글은 비교표와 FAQ 중심 정리형.':''}
 - category는 다음 목록 중 하나: ${S.settings.categories}. 맞는 게 없으면 가장 가까운 것을 고르고 category_note에 이유를 적는다.
6) 이 글 다음에 같은 키워드로 이어 쓸 시리즈 편 4~5개를 series에 제안한다. 첫 글(plan)과도, 서로도 겹치지 않게, 위 조사 자료만으로 쓸 수 있는 주제로. sub_keyword는 키워드를 글자 그대로 포함. fit은 이 편이 어디에 더 맞는지: 비교·기준·방법·체크리스트·계산처럼 오래 검색되는 정리형이면 "google", 생활 경험·후기·지역·시즌성·이슈형이면 "naver".
4) 신청 기간이 이미 끝났거나 7일 안에 끝나면 deadline_warning에 적는다. 아니면 빈 문자열.
5) 따라하기 절차를 수집한다. 신청·조회·사용 등 사람이 직접 해야 하는 일이 있으면, 공식 안내문·이용 가이드·FAQ에서 실제 화면 순서를 찾아 procedures에 정리한다.
 - channel: "온라인(사이트 이름)", "앱(앱 이름)", "방문" 등 경로별로 나눈다.
 - 단계마다: 접속할 곳(URL·앱 이름), 누를 메뉴·버튼의 정확한 이름, 입력하거나 고를 항목, 완료 후 나오는 화면·문구.
 - 메뉴·버튼 이름을 출처에서 직접 확인했으면 verified:true, 아니면 verified:false. 이름을 추측해서 채우지 않는다.
 - 절차가 필요 없는 키워드면 빈 배열.
결과는 <json>...</json> 태그 안에 JSON 하나로만 낸다. 태그 밖에는 아무것도 쓰지 않는다.
형식: {"deadline_warning":"","facts":[{"item":"","value":"","source":"URL","confirmed":true}],"procedures":[{"channel":"","url":"","need":["준비물"],"steps":[{"where":"","action":"","input":"","result":"","verified":true}],"source":"URL"}],"sources":[{"title":"","url":""}],"competitors":{"common":[""],"missing":[""],"errors":[""]},"plan":{"angle":"이 글이 다룰 내용 한 문장","category":"","category_note":""},"series":[{"sub_keyword":"","angle":"","fit":"naver 또는 google"}]}`;
  return {sys,user:`"${kw}" 리서치와 글 방향을 정리해줘.`};
}
function researchOf(pr,post){
  if(post.research)return post.research;
  if(post.researchFrom){const src=(pr.posts||[]).find(x=>x.id===post.researchFrom);if(src&&src.research)return src.research}
  return pr.research||{};
}
/* ===== 상위 글 공통 패턴 (한 달에 한 번 분석 → 모든 글쓰기에 짧게 반영) ===== */
function pPatterns(kws){
  kws=(kws||[]).filter(Boolean).slice(0,6);
  const sys=`너는 한국 블로그 검색 노출 분석가다. 오늘은 ${todayKST()} (한국 시간)이다.
[블로그 주제] ${S.settings.topic||'부업, 돈 아끼는 방법'}
[분석할 키워드] ${kws.length?kws.join(', '):'주제 안에서 1년 내내 많이 검색되는 대표 키워드 5개를 직접 고른다'}
할 일 (웹 검색은 최대 6회, 같은 검색 반복 금지):
1) 구글: 키워드마다 상위에 나오는 블로그·정보 글을 보고, 글 안에서 눈으로 확인되는 공통 특징만 정리한다 — 제목 형태, 첫 문단에서 바로 답하는지, 요약 상자·목차, 소제목 수와 형태(질문형 등), 표·목록·이미지 수, 대략 글 길이, 기준 날짜·업데이트 표시, 공식 출처 표기, 자주 묻는 질문.
2) 네이버: 네이버 블로그 상위 글을 찾을 수 있으면 같은 방식으로 정리한다. 찾지 못하면 naver.rules는 빈 목록으로 둔다(추측 금지).
3) 블로그 운영 기간, 다른 사이트 링크, 클릭 수처럼 글 밖 요소는 확인할 수 없으니 규칙에 넣지 않는다.
4) rules: 우리 글쓰기에 바로 적용할 규칙 6~8개. 한 줄짜리 짧은 명령문, 여러 상위 글에서 실제로 반복 확인된 것만. 키워드 반복 늘리기·낚시 제목·남의 문장 베끼기처럼 검색 품질 정책에 걸리는 요령은 절대 넣지 않는다.
5) stats: 분석한 상위 글의 대략적인 중간값 — len(본문 글자 수), h2(소제목 수), tables(표 수), images(이미지 수). 확인 못 한 값은 0.
6) examples: 분석한 글 최대 6개. url은 검색 결과에 나온 주소를 글자 그대로. why는 상위 이유로 보이는 글 안 특징 한 줄.
JSON 앞뒤에 설명을 쓰지 않는다. 결과는 <json>...</json> 태그 안에 JSON 하나로만.
형식: {"keywords":[""],"google":{"rules":[""],"stats":{"len":0,"h2":0,"tables":0,"images":0}},"naver":{"rules":[""],"stats":{"len":0,"h2":0,"tables":0,"images":0}},"examples":[{"where":"구글/네이버","kw":"","title":"","url":"","why":""}],"limits":"이번 분석의 한계 한 줄"}`;
  return {sys,user:'상위 글 공통 패턴을 분석해줘.'};
}
function patternBlock(pf){
  const P=S.settings.patterns,g=P&&P[pf];
  if(!g||!Array.isArray(g.rules)||!g.rules.length)return '';
  return `[상위 글 공통 패턴 (${String(P.at||'').slice(0,10)} 분석) — 글 구성에 반영한다. 조사 자료의 사실과 아래 품질 규칙이 항상 우선]\n${g.rules.slice(0,8).map(x=>'- '+String(x).slice(0,140)).join('\n')}\n\n`;
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

${patternBlock(wp?'google':'naver')}공통 규칙:
[제목] 아래 [메인 키워드]를 글자 그대로 맨 앞에 두고, 뒤에는 궁금증을 만드는 한 구절을 붙인다.${wp?'':`
- 네이버 글은 키워드 바로 뒤에 사람들이 실제로 검색창에 치는 질문 표현(○○ 조건 / ○○ 하는 법 / ○○ 기간 / ○○ 왜 ~?) 중 이 글에 맞는 것을 자연스럽게 잇고, 그다음 궁금증 구절을 붙인다. 예: "○○ 신청 조건, 이것 하나 빠뜨려서 탈락해요"`}
- 궁금증 = 답의 일부만 보여주고 나머지는 본문에 있다는 느낌. 예: "○○ 신청, 이것 하나 빠뜨려서 탈락해요", "○○ 받았는데 왜 금액이 다를까?", "○○ 12월 31일 지나면 생기는 일"
- 숫자·대상·마감 중 하나를 꼭 넣는다(조사 자료로 사실인 것만). 숫자는 정확히, 결론은 제목에서 다 말하지 않는다.
- 금지: 사실이 아닌 약속, "무조건/누구나/역대급/충격/소름", 느낌표 2개 이상, 키워드 2번 반복.

[문체 — 사람이 쓴 것처럼]
- 친근한 해요체. 어미를 섞는다(~해요/~거든요/~더라구요/~던 거 같아요/~죠/~이에요). 같은 어미가 3문장 연속 나오지 않게.
- 문장 길이를 섞는다(짧은 문장과 긴 문장). 한 문장 60자 이내를 기본으로.
- 정보 사이사이 실전 코멘트 1문장씩: "여기서 많이들 헷갈려요", "저라면 이것부터 확인할 것 같아요".
- 경험담 느낌의 끝맺음을 글 전체에 4~6번 자연스럽게 섞는다. 특히 "~그랬던 거 같아요", "~그렇더라구요", "~더라구요", "~던 것 같아요", "~거든요" 같은 구어체 끝맺음을 쓴다. 예: "공고문을 보니 생각보다 조건이 까다롭더라구요", "찾아보니 이 부분을 놓치는 분이 많았던 거 같아요", "막상 비교해 보면 차이가 꽤 나더라구요". 단, 내용은 조사 자료에 있는 사실만.
- 지어낸 경험은 절대 쓰지 않는다: "제가 신청해 보니", "저희 엄마가 받았는데", "직접 가봤더니" 같은 실제 행동·사람 이야기는 금지. 그런 이야기는 [경험 넣기] 자리로 비워 둔다.
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
- 조사 자료 missing_in_competitors(상위글이 모두 빠뜨린 정보)를 담은 섹션 최소 1개, errors_in_competitors가 있으면 바르게 짚는다.${wp?'':`
[네이버 AI 브리핑 인용 — 꼭 지킨다]
- 두괄식: 모든 ## 소제목 바로 아래 첫 문장은 그 소제목의 결론(답)이다. 이유·근거·예외는 그 뒤에 쓴다. 첫 문장을 "먼저", "많은 분들이", "~에 대해" 같은 말로 시작하지 않는다.
- 금액·기간·대상·조건·기준 같은 숫자 정보는 문장 속에 섞지 말고 "- 항목: 값" 목록으로 따로 뺀다(괄호 표기도 유지). 목록은 글 전체에 3곳 이상.
- 한 문단에는 한 가지 내용만. 결론이 흐린 문단을 만들지 않는다.
- "## 이런 경우는 해당 안 돼요"(주제에 따라 "이런 분에게는 안 맞아요") 소제목을 1개 넣고, 조사 자료로 확인한 제외 대상·조건 미달·주의할 경우를 2~4개 목록으로 쓴다. 자료에 없는 내용은 만들지 않는다.`}

[링크]
- 본문의 주소(URL)는 조사 자료의 sources·facts·procedures에 있는 주소만, 글자 그대로 쓴다. 주소를 새로 만들거나 고치지 않는다.
- 본문 중간에는 꼭 필요한 공식 사이트 1~2개만 링크하고, 나머지는 "## 출처"에 모은다.

[정확성 — 저품질 방지]
- 사실은 조사 자료에 있는 것만. confirmed:false는 "아직 확정되지 않았어요"라고 쓴다. 숫자·날짜를 지어내지 않는다.
- 다른 글·뉴스 문장을 베끼지 말고 직접 풀어 쓴다. 키워드를 억지로 반복하지 않는다.
${detail?`- 따라하기 섹션 (아주 자세히): 이 글 각도와 관련해 독자가 직접 해야 하는 일(신청·조회·사용·확인 등)이 있으면 "## ○○ 따라하기" 소제목을 만들고, 컴퓨터를 잘 모르는 60대도 그대로 따라 할 수 있게 쓴다.
  · 시작 전에 "준비물" 목록(신분증, 공동·간편인증서, 계좌 등)과 "걸리는 시간"을 먼저 적는다.
  · 단계마다 "### 1단계. (한 줄 요약)" 소제목을 달고, 그 아래에 이름표 목록으로 쓴다. 번호(①②, 1. 2.)를 붙이지 않는다:
    - **어디서:** 접속할 사이트 주소 또는 앱 이름, 휴대폰인지 PC인지
    - **누를 곳:** 버튼·메뉴 이름을 **"버튼 이름"**처럼 굵은 따옴표로, 화면 어디쯤인지(오른쪽 위, 맨 아래 등)
    - **입력할 것:** 칸 이름과 넣을 내용(예: 주민등록번호 앞자리 6자리)
    - **화면 이동:** 아래로 내려야 하면 "아래로 내리면 ○○이 보여요"처럼
    - **다음 버튼:** 마지막에 누를 버튼(**"다음"**, **"신청하기"** 등)
    - **끝났다는 신호:** 어떤 화면·문구가 뜨면 성공인지
    해당 없는 이름표는 줄 자체를 뺀다. 목록 바로 아래에 [사진 넣기: N단계 ○○ 화면 캡처]를 넣는다.
  · 조사 자료 procedures에서 verified:true인 메뉴·버튼 이름만 확정적으로 쓴다. verified:false이거나 자료에 없는 이름은 일반적인 표현으로 쓰고 바로 뒤에 [확인 필요: 실제 화면에서 버튼 이름 확인]을 붙인다. 버튼 이름을 지어내지 않는다.
  · 따라하기 끝에 "자주 막히는 부분" 3개 안팎(증상 → 해결)을 넣는다.
  · 이 글 각도에 직접 해야 하는 일이 없으면 따라하기 섹션은 넣지 않는다. 다른 글의 따라하기와 같은 절차를 반복하지 않는다.
`:''}- [사진 넣기: 무엇을] 자리를 ${detail?'따라하기 단계마다 + 그 밖에 1~2곳':'2~3곳'}, [경험 넣기: ○○] 자리를 2~3곳 본문 흐름에 맞게 넣는다. ○○에는 무엇을 쓰면 좋을지 구체적으로 적는다 — 예) [경험 넣기: 신청하다 헷갈렸던 화면이나 실수한 점], [경험 넣기: 처음 생각과 실제가 달랐던 점], [경험 넣기: 실패했다가 해결한 방법]. 실제 경험·실패·해결 과정이 담긴 글이 AI 브리핑과 독자 신뢰에 유리하다. 경험 내용은 지어내지 않고 자리만 표시한다.
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
본문의 [경험 넣기] 자리마다: 자리 이름 한 줄, 그 아래 예시 문장 2개(- 로 시작). "~더라구요/~그랬던 거 같아요" 말투로, 사용자가 자기 사실로 바꿔 넣을 부분은 [ ]로 표시(예: "- [신청한 날]에 복지로로 해 보니 [걸린 시간] 정도 걸리더라구요").
@@CHECK
- 항목 | 본문에 쓴 값 | ✅ 출처와 일치 또는 ⚠️ 확인 필요
(본문의 [확인 필요] 버튼·메뉴 이름도 ⚠️ 항목으로 모두 넣는다)
@@META
검색 결과에 보일 설명 한 줄, 80~150자, [메인 키워드] 포함
@@SLUG
워드프레스 글 주소용 영어 소문자-하이픈 3~6단어 (네이버 글이면 빈 줄)
@@IMAGE
대표 그림용 영어 프롬프트 한 줄 (글 주제를 상징하는 장면, flat illustration, soft colors, no text, no letters, no logos, no real people's faces)
@@TITLES
위 [제목] 규칙을 지킨 다른 후보 3개, 한 줄에 하나. 각각 다른 궁금증 방식(질문형 / 놓치면 손해형 / 숫자·대상형).`;
  // 2) 이 글 전용 부분
  const spec=`[플랫폼] ${wp?'워드프레스(구글 검색 유입용)':'네이버 블로그'}
[메인 키워드] ${KW}
${showSub?`[이 글의 세부 키워드] ${sp.sub_keyword}\n`:''}[이 글의 방향] ${sp.angle||'검색하는 사람이 가장 알고 싶은 것 중심'}
[카테고리] ${sp.category}
${sibs.length?`[같은 시리즈의 다른 글 — 내용이 겹치지 않게]\n${sibs.map(x=>'- '+(x.title||x.spec.sub_keyword)+': '+(x.spec.angle||'')).join('\n')}\n`:''}${crossBlock(pr.crossLinks,'md')}이 글의 규칙:
- 제목 ${wp?'40자 안팎':'30자 안팎'}.
- 본문에 [메인 키워드] ${wp?'4~6':'3~5'}회.
${wp?'- FAQ 소제목 아래 질문 3~5개와 답을 넣는다. 비교표를 중심에 둔다.\n':''}- 분량: ${wp?'2,500~3,500자':'3,000~4,500자 (늘어지지 않게: 목록·표·단계로 정보 밀도를 높여서)'}${detail?' (따라하기 섹션이 있으면 그만큼 더 길어져도 된다)':''}.`;
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
fit은 이 편이 어디에 더 맞는지: 비교·기준·방법·체크리스트·계산처럼 오래 검색되는 정리형이면 "google", 생활 경험·후기·지역·시즌성·이슈형이면 "naver".
결과는 <json>...</json> 안에 JSON 하나로만: {"series":[{"sub_keyword":"","angle":"이 편이 다룰 내용 한 문장","fit":"naver 또는 google"}]}`;
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
/* ===== 블로그스팟·워드프레스 자동 발행 (구글 검색·애드센스용) ===== */
function langOf(blog){return (blog&&blog.lang)==='en'?'en':'ko'}
function pAutoKeywords(blog,exclude){
  const en=langOf(blog)==='en';exclude=(exclude||[]).filter(Boolean).slice(-200);
  const sys=`너는 구글 검색으로 들어오는 블로그(${blog.type==='blogger'?'블로그스팟':'워드프레스'})의 키워드 리서처다. 오늘은 ${todayKST()} (한국 시간)이다.
[블로그 주제 — 반드시 이 안에서만] ${blog.topic||S.settings.topic||'부업, 돈 아끼는 방법'}
[독자] ${en?'미국 등 영어권 독자. 키워드는 영어로.':'한국 독자. 키워드는 한국어로.'}
구글 애드센스 수익은 오래 검색되는 정리형(에버그린) 키워드가 유리하다. 1년 이상 꾸준히, 많이 검색되는 키워드를 우선한다. 웹 검색 3회 이내로 주제 관련 최근 이슈와 사람들이 실제로 묻는 질문을 확인하고 후보를 고른다.
제외할 키워드:
- 답이 한 줄로 끝나는 것(전화번호·영업시간 등), 확정 발표가 없는 루머, 추정 금액이 필요한 것
- 투자 종목 추천, 대출 권유, 의료 판단처럼 독자에게 손해를 줄 수 있는 주제, 수익 보장 부업, 다단계·사기 의심 부업
- 블로그 주제와 관계없는 것
${exclude.length?`- 이미 쓴 키워드, 그리고 단어만 바꾼 같은 주제(이것과 겹치면 안 됨): ${exclude.join(', ')}
`:''}후보 10개 — 그중 에버그린(evergreen:true) 최소 7개. 2~5단어(질문형 포함 가능), 너무 좁아서 아무도 안 칠 표현은 피한다. 서로 다른 주제여야 한다(같은 제도를 단어만 바꾼 변형은 1개로 친다).
opportunity: 1~5. 검색 수요가 꾸준하고 상위 글이 부실할수록 높게, 공식 출처로 정확히 쓸 수 있으면 +1.
결과는 <json>...</json> 태그 안에 JSON 하나로만. 형식: {"keywords":[{"keyword":"","reason":"한 문장","intent":"정보/방법/비교","evergreen":true,"opportunity":3}]}`;
  return {sys,user:'서로 다른 키워드 후보 10개를 찾아줘.'};
}
// 네이버 글에서 이미 확인한 공식 사실·출처를 다시 쓰고, 구글 상위 글만 가볍게 확인한다 (웹 검색 1회)
function pAutoResearchLite(kw,blog,base){
  base=base||{};
  const known=JSON.stringify({deadline_warning:base.deadline_warning||undefined,facts:(base.facts||[]).slice(0,20).map(f=>({item:f.item,value:f.value,confirmed:f.confirmed===false?false:undefined})),sources:(base.sources||[]).slice(0,8).map(x=>({title:String(x.title||'').slice(0,60),url:x.url}))}).slice(0,9000);
  const sys=`너는 구글 검색용 블로그 글 1개를 준비하는 리서처다. 오늘은 ${todayKST()} (한국 시간)이다.
키워드: "${kw}" · 독자: 한국
[이미 확인한 공식 자료 — 사실은 이것을 쓴다. 다시 찾지 않는다]
${known}
할 일 (웹 검색은 1회만):
1) 구글에서 "${kw}"로 상위에 나오는 글 1~3개의 구성을 본다. top에 제목·주소, common에 모두 다루는 내용, missing에 모두 빠뜨렸지만 독자에게 필요한 내용, errors에 틀리거나 오래된 내용.
2) questions: 사람들이 이 키워드와 함께 묻는 질문 5~8개.
3) outline: 이 글의 소제목(h2) 5~7개. common을 기본으로, missing을 차별점으로 최소 1개, questions를 질문형 소제목에 반영. 위 공식 자료로 쓸 수 있는 내용만.
4) extra_facts: 위 자료에 없는데 꼭 필요한 사실을 상위 글이 인용한 공식 출처에서 확인했을 때만, 3개 이하(source 주소 필수). 없으면 빈 목록.
주소(URL)는 검색 결과에 나온 주소를 글자 그대로. 추측해서 만들지 않는다. JSON 앞뒤에 설명을 쓰지 않는다.
결과는 <json>...</json> 태그 안에 JSON 하나로만.
형식: {"competitors":{"top":[{"title":"","url":""}],"common":[""],"missing":[""],"errors":[""]},"questions":[""],"outline":[{"h2":"","point":""}],"extra_facts":[{"item":"","value":"","source":"URL","confirmed":true}]}`;
  return {sys,user:`"${kw}" 구글 상위 글 확인과 글 구성을 정리해줘.`};
}
function pAutoResearch(kw,blog){
  const en=langOf(blog)==='en';
  const sys=`너는 구글 검색용 블로그 글 1개를 준비하는 리서처다. 오늘은 ${todayKST()} (한국 시간)이다.
키워드: "${kw}" · 독자: ${en?'영어권(미국 중심)':'한국'}
할 일 (웹 검색은 최대 4회, 같은 내용 반복 검색 금지):
1) 벤치마킹: 구글에서 이 키워드로 상위에 나오는 글 1~3개를 찾아 소제목 구조를 본다. top에 제목·주소, common에 세 글이 모두 다루는 내용, missing에 세 글이 모두 빠뜨렸지만 독자에게 필요한 내용, errors에 틀리거나 오래된 내용.
2) 관련 질문: 사람들이 이 키워드와 함께 묻는 질문(구글 "관련 질문"·검색 제안 형태) 5~8개를 questions에.
3) 1차 출처(정부·공공기관·공식 홈페이지·공식 보도자료)에서 날짜·금액·대상·조건·방법 등 핵심 사실을 facts에. 확정 안 된 정보는 confirmed:false, 추정치를 만들지 않는다.
4) outline: 이 글의 소제목(h2) 5~7개 계획. common을 기본으로 깔고, missing을 차별점으로 최소 1개, questions를 질문형 소제목에 반영. point는 그 소제목에서 다룰 내용 한 줄.
5) 사람이 직접 해야 하는 신청·조회 절차가 있으면 procedures에 (경로 2개 이하, 단계 8개 이하). 메뉴·버튼 이름은 출처에서 확인한 것만 verified:true.
주소(URL)는 검색 결과에 나온 주소를 글자 하나 바꾸지 않고 그대로 적는다. 주소를 추측해서 만들지 않는다.
답은 짧게: facts 15개 이하(value 한 줄), 각 목록 5개 이하, sources 6개 이하. JSON 앞뒤에 설명을 쓰지 않는다.
결과는 <json>...</json> 태그 안에 JSON 하나로만.
형식: {"deadline_warning":"","facts":[{"item":"","value":"","source":"URL","confirmed":true}],"procedures":[{"channel":"","url":"","steps":[{"where":"","action":"","result":"","verified":true}]}],"sources":[{"title":"","url":""}],"competitors":{"top":[{"title":"","url":""}],"common":[""],"missing":[""],"errors":[""]},"questions":[""],"outline":[{"h2":"","point":""}]}`;
  return {sys,user:`"${kw}" 벤치마킹·리서치와 글 구성을 정리해줘.`};
}
function compactAuto(r){
  r=r||{};const c=r.competitors||{};
  const o={deadline_warning:r.deadline_warning||undefined,
    facts:(r.facts||[]).slice(0,20).map(f=>({item:f.item,value:f.value,confirmed:f.confirmed===false?false:undefined,source:f.source})),
    procedures:(r.procedures||[]).slice(0,2),competitors_common:(c.common||[]).slice(0,6),competitors_missing:(c.missing||[]).slice(0,6),competitors_errors:(c.errors||[]).slice(0,4),
    questions:(r.questions||[]).slice(0,8),outline:(r.outline||[]).slice(0,7),
    sources:(r.sources||[]).slice(0,6).map(x=>({title:String(x.title||'').slice(0,80),url:x.url}))};
  return JSON.stringify(o).slice(0,14000);
}
// 내 다른 블로그 글로 보내는 링크 (관련 있는 것만, 최대 2~3개)
function crossBlock(list,fmt){
  list=(list||[]).filter(x=>x&&x.url&&x.title).slice(0,15);if(!list.length)return '';
  return `[내 다른 블로그 글 — 독자가 이어서 읽으면 도움이 될 글]
${list.map(x=>'- '+String(x.title).replace(/\n/g,' ')+' | '+x.url).join('\n')}
- 이 중 이 글 주제와 정말 관련 있는 글만 ${fmt==='html'?'1~3개':'1~2개'} 골라 ${fmt==='html'?'자주 묻는 질문 바로 앞에 <h2>함께 보면 좋은 글</h2><ul><li><a href="주소">제목</a></li></ul>':'출처 바로 앞 "## 함께 보면 좋은 글"에 "- [제목](주소)"'} 형식으로 넣는다. 관련 있는 글이 없으면 넣지 않는다(억지로 연결 금지). 주소는 위에 적힌 그대로 쓴다(이 주소들은 조사 자료 밖이어도 써도 된다). 같은 글을 두 번 넣지 않는다.
`;
}
function pAutoWrite(kw,r,blog,recent,links){
  const en=langOf(blog)==='en',L=autoLabels(en),d=todayKST();
  const dateStr=en?new Date(d+'T00:00:00Z').toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}):d.replace(/^(\d+)-(\d+)-(\d+)$/,(m,y,mo,dd)=>y+'년 '+(+mo)+'월 '+(+dd)+'일');
  const sys=`너는 구글 검색 독자를 위한 정보 블로그 편집자다. 이 글은 구글 애드센스가 붙는 ${blog.type==='blogger'?'블로그스팟':'워드프레스'} 블로그에 그대로 발행된다. 오늘은 ${d}이다.
${en?'모든 출력(제목·본문·설명·태그)은 자연스러운 미국 영어로 쓴다. 한국 기관·제도를 다루면 영어 독자가 이해하도록 짧게 풀어 준다.':'모든 출력은 한국어로 쓴다.'}
[블로그 주제] ${blog.topic||S.settings.topic||''}
[키워드] ${kw}
[조사 자료]
${compactAuto(r)}
${(recent||[]).length?`[이 블로그에 이미 올린 글 — 내용·제목이 겹치지 않게]\n${recent.slice(0,15).map(t=>'- '+t).join('\n')}\n`:''}${crossBlock(links,'html')}
${en?'':patternBlock('google')}[품질 기준 — 애드센스·구글 스팸 정책 통과가 최우선]
- 독자 질문에 실제로 답하는 독창적이고 유용한 글. 상위 글을 요약·재배열한 글이 아니라, 조사 자료의 competitors_missing(상위 글이 모두 빠뜨린 내용)과 competitors_errors 바로잡기를 담아 더 나은 글을 만든다.
- 사실은 조사 자료에 있는 것만. confirmed:false는 ${en?'"not yet confirmed"':'"아직 확정되지 않았어요"'}라고 쓴다. 숫자·날짜·사례를 지어내지 않는다.
- 지어낸 경험·사례 금지: ${en?'"I tried", "when I applied", "my mom"':'"제가 신청해 보니", "직접 해보니", "저희 엄마가"'} 같은 1인칭 행동·주변인 이야기를 쓰지 않는다. 대신 ${en?'"Based on the official notice", "A common mistake is"':'"공고문 기준으로 보면", "많이 헷갈리는 부분은"'}처럼 쓴다.
- 과장 금지: ${en?'"guaranteed", "100%", "secret", "shocking"':'"무조건", "보장", "역대급", "충격", "소름", "누구나"'}. 수익·절약 금액을 약속하지 않는다.
- 키워드는 본문에 4~6번 자연스럽게. 억지 반복 금지. 다른 글 문장을 베끼지 않는다.
- 돈과 관련된 주제라 신뢰가 중요하다: 공식 출처를 근거로 쓰고, 조건이 사람마다 다르면 그렇다고 밝힌다.

[제목] 키워드를 글자 그대로 앞쪽에 넣고, 본문 내용과 정확히 일치하는 궁금증 한 구절을 붙인다. ${en?'50~65자(영문)':'28~40자'}. 느낌표·낚시성 표현 금지.

[본문 — HTML만. 쓸 수 있는 태그: h2, h3, p, ul, ol, li, table, thead, tbody, tr, th, td, strong, em, a, div. h1·script·style·iframe·class·이미지 태그는 쓰지 않는다]
1. 도입 <p> 2~3문장: 독자가 궁금한 것에 바로 답하고, 키워드를 넣는다.
2. 요약 상자 (이 틀 그대로, li 3~5개, 숫자·날짜는 단위와 함께):
<div style="${BOX_STYLE}"><p style="margin:0 0 6px"><strong>${L.box}</strong></p><ul style="margin:0;padding-left:20px"><li>…</li></ul></div>
3. <p>${en?`As of ${dateStr}, …`:`${dateStr} 기준으로 …`}</p> 한 문장으로 기준일과 핵심 답.
4. 조사 자료 outline을 따라 <h2> 5~7개. 2개 이상은 questions에서 가져온 질문형. 필요하면 <h3>. 한 문단 3~4문장 이내.
   - 정의 문장 1개: "○○은(는) ~입니다/이에요" 혼자 읽어도 뜻이 통하게.
   - 비교·조건을 정리한 <table> 1개 이상(<thead> 포함). 절차는 <ol>.
5. (내 다른 블로그 글 중 관련 글이 있으면 여기 "함께 보면 좋은 글") 그다음 <h2>${L.faq}</h2> 아래 <h3>질문</h3><p>답 1~3문장</p> 4~5개 (questions 중 본문에서 덜 다룬 것).
6. <h2>${L.src}</h2> <ul>에 조사 자료의 공식 출처만 <a href="주소" target="_blank" rel="noopener">이름</a>. 주소는 조사 자료에 있는 것을 글자 그대로. 본문 중간 링크는 꼭 필요한 공식 사이트 1~2개만.
7. 마지막 <p><em>${en?`This article summarizes publicly available information as of ${dateStr}. Eligibility and amounts can change, so check the official site before you apply.`:`이 글은 ${dateStr} 기준 공개된 자료를 정리한 것이에요. 조건·금액은 바뀔 수 있으니 신청 전 공식 사이트에서 꼭 확인하세요.`}</em></p>
분량: ${en?'1,200~1,800 단어':'본문 글자 3,000~4,500자'}.
문체: ${en?'clear, friendly, plain English; short sentences; no fluff intros like "In today\'s world".':'친근한 해요체 정보글. 어미를 섞고(~해요/~이에요/~거든요/~죠), 같은 어미 3번 연속 금지. "알아보겠습니다", "살펴보겠습니다", "결론적으로", "도움이 되셨길 바랍니다" 금지.'}
[ ] 같은 자리 표시, 이미지 자리, "@@" 같은 표시는 본문에 쓰지 않는다.

출력 형식 (이 순서, 표시줄 그대로, 다른 말 없이):
@@TITLE
제목 한 줄
@@META
검색 결과 설명 한 줄 (${en?'140~160자':'90~150자'}, 키워드 포함)
@@SLUG
영어 소문자-하이픈 3~6단어
@@LABELS
태그 5개, 쉼표로 구분
@@HTML
본문 HTML
@@IMAGE
대표 사진 검색어 영어 2~4단어 (예: saving money budget)
@@END`;
  return {sys,user:`위 기준대로 "${kw}" 글을 써줘.`};
}
function pAutoFix(raw,issues){
  return {sys:`너는 블로그 글 편집자다. 아래 글을 [고칠 점]만 고쳐서, 받은 것과 똑같은 출력 형식(@@TITLE부터 @@END까지 전부)으로 다시 낸다. 고칠 점과 관계없는 부분은 최대한 그대로 둔다. 사실을 새로 지어내지 않는다.
[고칠 점]
${issues.map(s=>'- '+s).join('\n')}`,user:raw};
}
  return {pPatterns,pKeywords,pResearch,pResearchOne,pWrite,pSeries,buildPosts,buildMulti,buildSeries,applyPlan,researchOf,pAutoKeywords,pAutoResearch,pAutoResearchLite,pAutoWrite,pAutoFix};
}

/* ===== 자동 발행 품질 검사 (0원 · 사이트와 서버 공용) ===== */
const BOX_STYLE='border:1px solid #d0d7e2;border-radius:10px;padding:14px 18px;margin:16px 0;background:#f7f9fc';
function autoLabels(en){return en?{box:'Key facts',faq:'Frequently asked questions',src:'Sources'}:{box:'핵심 요약',faq:'자주 묻는 질문',src:'출처'}}
function htmlText(h){return String(h||'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim()}
const nsp=s=>String(s||'').toLowerCase().replace(/[\s\-_.,·!?'"()]+/g,'');
function bigrams(s){const t=nsp(s),o=new Set();for(let i=0;i<t.length-1;i++)o.add(t.slice(i,i+2));return o}
// 같은 키워드인지: 글자 그대로 같거나, 짧은 쪽이 긴 쪽에 거의 다 들어 있으면 같은 주제로 본다
function kwDup(a,b){
  const x=nsp(a),y=nsp(b);if(!x||!y)return false;if(x===y)return true;
  const A=bigrams(a),B=bigrams(b),m=Math.min(A.size,B.size);if(m<3)return false;
  let n=0;A.forEach(g=>{if(B.has(g))n++});return n/m>=0.8;
}
// 문장 단위로 겹치는지 본다 (9글자 조각). 안내 문구·요약 상자 제목처럼 모든 글에 들어가는 부분은 뺀다
const BOILER=/(이 글은 [^.]*확인하세요\.?|This article summarizes[^.]*\.|핵심 요약|Key facts|자주 묻는 질문|Frequently asked questions|출처|Sources)/g;
function shingles(t,k){t=nsp(String(t||'').replace(BOILER,' '));const s=new Set();for(let i=0;i+k<=t.length;i++)s.add(t.slice(i,i+k));return s}
function textSim(a,b){const A=shingles(a,9),B=shingles(b,9);if(!A.size||!B.size)return 0;let n=0;A.forEach(g=>{if(B.has(g))n++});return n/Math.min(A.size,B.size)}
// 발행해도 되는지 검사. fails가 하나라도 있으면 공개 발행하지 않고 임시저장으로 돌린다.
function autoGate(sec,kw,lang,past,pat){
  const en=lang==='en',L=autoLabels(en),fails=[],warns=[],fixable=[];
  const title=String(sec.TITLE||'').trim(),html=String(sec.HTML||''),text=htmlText(html),meta=String(sec.META||'').trim();
  const add=(msg,fix)=>{fails.push(msg);if(fix)fixable.push(fix)};
  if(!('END' in sec))add('글이 끝까지 오지 않았어요(중간에 끊김)');
  if(!title)add('제목이 없어요','제목을 규칙대로 쓴다');
  if(!html)add('본문이 없어요');
  const len=en?text.split(/\s+/).length:text.replace(/\s/g,'').length,min=en?900:2200;
  if(html&&len<min)add(`본문이 짧아요 (${len}${en?'단어':'자'} · 최소 ${min})`,`본문을 ${en?'1,200단어':'3,000자'} 이상으로 늘린다. 조사 자료의 빠진 내용·질문을 더 깊게 다룬다`);
  if(title&&!nsp(title).includes(nsp(kw)))add('제목에 키워드가 없어요',`제목에 "${kw}"를 글자 그대로 넣는다`);
  if(text&&!nsp(text.slice(0,en?600:300)).includes(nsp(kw)))add('도입부에 키워드가 없어요',`첫 문단에 "${kw}"를 자연스럽게 넣는다`);
  const kwN=nsp(kw)?nsp(text).split(nsp(kw)).length-1:0;
  if(kwN>12)add(`키워드가 너무 많이 반복돼요 (${kwN}번)`,'키워드 반복을 6번 이하로 줄인다');
  const h2=(html.match(/<h2[\s>]/gi)||[]).length;
  if(h2<4)add(`소제목이 부족해요 (${h2}개)`,'h2 소제목을 5개 이상으로 구성한다');
  if(!new RegExp(L.box).test(html))add('요약 상자가 없어요',`도입 바로 아래에 "${L.box}" 요약 상자를 넣는다`);
  const fi=html.search(new RegExp('<h2[^>]*>\\s*'+L.faq,'i'));
  const faqN=fi>=0?(html.slice(fi).split(/<h2[\s>]/i)[1]||'').split(/<h3[\s>]/i).length-1:0;
  if(faqN<3)add(`자주 묻는 질문이 부족해요 (${faqN}개)`,`"${L.faq}" h2 아래에 h3 질문 4~5개와 답을 넣는다`);else if(faqN<4)warns.push('자주 묻는 질문이 3개예요');
  const tblN=(html.match(/<table[\s>]/gi)||[]).length;
  if(!tblN)warns.push('표가 없어요');
  // 상위 글 패턴과 비교 (경고만 · 공개를 막지는 않음)
  if(pat&&!en){if(pat.len>0&&len<pat.len*0.8)warns.push(`상위 글보다 짧아요 (상위 글 약 ${pat.len}자)`);if(pat.tables>=2&&tblN<pat.tables)warns.push(`상위 글보다 표가 적어요 (상위 글 약 ${pat.tables}개)`)}
  const links=(html.match(/<a\s[^>]*href="https?:\/\/[^"]+"/gi)||[]).length;
  if(!links)add('출처 링크가 없어요',`"${L.src}" 소제목 아래에 조사 자료의 공식 출처 링크를 넣는다`);
  if(/\[(사진|경험|확인|링크|이미지|TODO)|@@|lorem ipsum/i.test(html))add('자리 표시([ ])가 남아 있어요','[ ] 자리 표시를 모두 지우고 문장으로 완성한다');
  if(/<(script|iframe|style|form|object|embed)[\s>]/i.test(html))add('쓰면 안 되는 태그가 있어요','script·iframe·style 태그를 지운다');
  const hype=en?/\b(guaranteed|100% (free|safe|sure)|get rich|shocking|secret trick)\b/i:/(무조건|수익\s*보장|100%\s*보장|역대급|충격|소름|대박)/;
  const hm=(title+' '+text).match(hype);if(hm)add(`과장 표현이 있어요 ("${hm[0]}")`,`"${hm[0]}" 같은 과장 표현을 사실대로 고친다`);
  const fake=en?/\b(I|we) (tried|applied|signed up|used it|got paid)\b|\bmy (mom|dad|wife|husband|friend)\b/i:/(제가|저는|저도)\s*(직접\s*)?(신청|해\s?보|받아\s?보|가\s?보|써\s?보|가입해)|저희\s*(엄마|아빠|남편|아내|가족|부모님)/;
  const fm=text.match(fake);if(fm)add(`지어낸 경험처럼 보이는 문장이 있어요 ("${fm[0]}")`,`"${fm[0]}"처럼 1인칭 경험 문장을 "공고문 기준으로 보면" 같은 정보형 문장으로 바꾼다`);
  let maxSim=0,simTitle='';(past||[]).forEach(p=>{const s=textSim(text,p.text||'');if(s>maxSim){maxSim=s;simTitle=p.title||''}});
  if(maxSim>=0.3)add(`예전 글과 내용이 많이 겹쳐요 (${Math.round(maxSim*100)}% · ${simTitle})`);
  if(meta&&(meta.length<(en?100:60)||meta.length>(en?170:160)))warns.push(`검색 설명 길이 ${meta.length}자`);
  if(!meta)warns.push('검색 설명이 없어요');
  if(title.length>(en?70:45))warns.push(`제목이 길어요 (${title.length}자)`);
  const score=Math.max(0,100-fails.length*20-warns.length*5);
  return {ok:!fails.length,score,fails,warns,fixable,len,sim:+maxSim.toFixed(2)};
}
root.BH={create,extractJSON,parseSec,todayKST,uid,ANGLES,PRICES,SEARCH_USD,costOf,estimate,htmlText,kwDup,textSim,autoGate,BOX_STYLE,version:21};
})(typeof globalThis!=='undefined'?globalThis:this);
