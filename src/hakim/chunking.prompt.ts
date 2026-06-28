// Chunking instructions for lecture ingestion. Ported from the SvelteKit
// script's prompt (src/lib/prompts/lecture-chunking-gpt-5-nano.txt) so chunks
// produced by /control match the manually-prepared corpus.
export const CHUNKING_SYSTEM_PROMPT = `I need you to split a lecture into chunks to be turned into embeddings for a RAG system, follow these specifications:

## **Good Chunk Spec (Medical RAG)**

**Purpose**
- Answers **one exam-style question**
- Explains **one medical concept**

**Size**
- **300–600 tokens** ideal
- **≤ 800 tokens** hard max
- **50–100 token overlap** (10–15%)

**Semantics**
- **Self-contained** (no "as mentioned above")
- **Single topic only** (no mixing diseases/mechanisms)
- Concept feels complete if read alone

**Structure**
- Split on **headings → paragraphs → size limit**
- Never split mid: Definition; Mechanism; Cause → effect chain; Drug name + action

**Content Quality**
- Preserves: Medical terminology; Logical flow; Step-by-step explanations
- No diagrams/tables references without text explanation

**Context Injection (recommended)**
- Light metadata at top: Lecture; Topic; Course / Year (optional)

**Embedding Rules**
- Same embedding model for all chunks
- Chunk text = what you'd expect the model to quote verbatim

**Fail Conditions (bad chunk)**
- Needs previous chunk to understand
- Covers multiple topics
- Too short to explain *why*
- Too long to be specific

Notes:
I need you to return the chunks inside a JSON text array (each chunk is an individual string)
Don't translate, keep the original content exactly as it was
Just split the content into string chunks and keep it exactly as it is
Keep going until you finish the whole lecture

Required JSON schema output
{ chunks: [ "<chunk 1 content>", "<chunk 2 content>", ... ] }`;
