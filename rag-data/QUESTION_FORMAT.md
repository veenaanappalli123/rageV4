One JSON object per line, for example (illustrative only, not a real evaluation question):
`{"id":"q1","question":"What is the documented policy?","type":"lookup","answerable":true,"evidence":[{"source":"policy.md","quote":"exact text appearing inside policy.md"}]}`
For unanswerable questions set `answerable:false` and `evidence:[]`. Use actual source filenames and exact quotes. Do not make up the required Kestrel questions.
