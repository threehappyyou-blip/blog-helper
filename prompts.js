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
function researchOf(pr,post){
  if(post.research)return post.research;
  if(post.researchFrom){const src=(pr.posts||[]).find(x=>x.id===post.researchFrom);if(src&&src.research)return src.research}
  return pr.research||{};
}
/* ===== 상위 글 공통 패턴 (한 달에 한 번 분석 → 모든 글쓰기에 짧게 반영) ===== */
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
  // 글쓰기 지시문(프롬프트)은 비공개 서버에만 있어요. 이 파일에는 화면에 필요한 구조 함수만 남겨요.
  return {researchOf,buildPosts,buildMulti,buildSeries,applyPlan};
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
root.BH={create,extractJSON,parseSec,todayKST,uid,ANGLES,PRICES,SEARCH_USD,costOf,estimate,htmlText,kwDup,textSim,autoGate,BOX_STYLE,version:23};
})(typeof globalThis!=='undefined'?globalThis:this);
