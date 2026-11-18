import fs from 'node:fs';
import path from 'node:path';
import {indexCorpus,loadQuestions,evaluate,generateAnswer} from '../server/rag-core.js';

const args=process.argv.slice(2);
const flag=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]};
const corpus=args[0];
const sizes=(flag('--sizes','500,800')).split(',').map(Number);
const overlaps=(flag('--overlaps','80,120')).split(',').map(Number);
const k=Number(flag('--k','5'));
const generate=args.includes('--generate'),noContext=args.includes('--no-context');
if(!corpus||!/^[\w-]+$/.test(corpus)||sizes.some(n=>!Number.isInteger(n))||overlaps.some(n=>!Number.isInteger(n))){console.error('Usage: npm run rag:evaluate -- <corpus> [--sizes 500,800] [--overlaps 80,120] [--k 5] [--generate] [--no-context]');process.exit(1)}
try{
 const dir=path.join('rag-data',corpus),questions=loadQuestions(path.join(dir,'questions.jsonl'));
 fs.mkdirSync('rag-results',{recursive:true});
 const comparisons=[];
 for(const size of sizes)for(const overlap of overlaps){
  if(overlap>=size)continue;
  const chunks=indexCorpus(path.join(dir,'docs'),{size,overlap});
  const result=evaluate(chunks,questions);
  for(const row of result.rows){
   if(generate)try{row.generated=await generateAnswer(row.question,row.retrieved.slice(0,k));}catch(e){row.generation_error=e.message;}
   if(noContext)try{row.no_context=await generateAnswer(row.question,[],{noContext:true});}catch(e){row.no_context_error=e.message;}
  }
  const file=path.join('rag-results',`${corpus}-${size}-${overlap}.json`);
  const config={size,overlap,k,retriever:'BM25',generate,noContext};
  fs.writeFileSync(file,JSON.stringify({corpus,config,grading_rules:{correct:'Fully supported, or clearly abstains when unanswerable',partial:'Some supported details but incomplete',wrong:'Incorrect answer, including an answer to an unanswerable question',unsupported:'Claims not justified by cited documents'},...result},null,2));
  comparisons.push({file,config,summary:result.summary,by_type:result.by_type});
 }
 const file=path.join('rag-results',`${corpus}-comparison.json`);
 fs.writeFileSync(file,JSON.stringify(comparisons,null,2));
 console.log(JSON.stringify({comparison:file,runs:comparisons.map(x=>({file:x.file,config:x.config,summary:x.summary}))},null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
