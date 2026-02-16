use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Value;
use std::path::Path;

/// Local embedding using all-MiniLM-L6-v2 ONNX model (384-dim).
///
/// Requires model files at a known path:
///   - model.onnx (~80MB)
///   - tokenizer.json
///
/// If files are missing, `Embedder::new()` returns an error and RAG
/// operates in storage-only mode (no semantic search, only recency).
pub struct Embedder {
    session: Session,
    tokenizer: tokenizers::Tokenizer,
}

impl Embedder {
    /// Initialize the embedder from ONNX model and tokenizer files.
    pub fn new(model_dir: &Path) -> Result<Self, String> {
        let model_path = model_dir.join("model.onnx");
        let tokenizer_path = model_dir.join("tokenizer.json");

        if !model_path.exists() {
            return Err(format!(
                "ONNX model not found at {}. Download all-MiniLM-L6-v2 ONNX files to this directory.",
                model_path.display()
            ));
        }
        if !tokenizer_path.exists() {
            return Err(format!(
                "Tokenizer not found at {}. Download tokenizer.json for all-MiniLM-L6-v2.",
                tokenizer_path.display()
            ));
        }

        let session = Session::builder()
            .and_then(|b| b.with_optimization_level(GraphOptimizationLevel::Level3))
            .and_then(|b| b.commit_from_file(&model_path))
            .map_err(|e| format!("Failed to load ONNX model: {e}"))?;

        let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {e}"))?;

        Ok(Self { session, tokenizer })
    }

    /// Generate a 384-dim embedding for the given text.
    /// Performs tokenization, inference, mean pooling, and L2 normalization.
    pub fn embed(&mut self, text: &str) -> Result<Vec<f32>, String> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| format!("Tokenization failed: {e}"))?;

        let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
        let attention_mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|&m| m as i64)
            .collect();
        let token_type_ids: Vec<i64> =
            encoding.get_type_ids().iter().map(|&t| t as i64).collect();

        let seq_len = input_ids.len();

        // Clone attention_mask before it's moved into the tensor — we need it for mean pooling.
        let attn_mask = attention_mask.clone();

        // ort v2 Value::from_array requires owned data: (shape, Vec<T>) or (shape, Box<[T]>).
        // The ort::inputs! macro returns Vec<(Cow<str>, SessionInputValue)>, not Result.
        let inputs = ort::inputs![
            "input_ids" => Value::from_array(([1usize, seq_len], input_ids)).map_err(|e| format!("input_ids: {e}"))?,
            "attention_mask" => Value::from_array(([1usize, seq_len], attention_mask)).map_err(|e| format!("attention_mask: {e}"))?,
            "token_type_ids" => Value::from_array(([1usize, seq_len], token_type_ids)).map_err(|e| format!("token_type_ids: {e}"))?,
        ];

        let outputs = self
            .session
            .run(inputs)
            .map_err(|e| format!("ONNX inference failed: {e}"))?;

        // ort v2 try_extract_tensor returns (&Shape, &[T]).
        // We destructure and work with the flat data directly.
        let (_shape, flat_data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract tensor: {e}"))?;

        // Output tensor is [1, seq_len, hidden_dim].
        // Derive hidden_dim from flat data length (batch_size=1).
        let hidden_dim = if seq_len > 0 {
            flat_data.len() / seq_len
        } else {
            return Err("Empty sequence after tokenization".into());
        };

        // Mean pooling over token embeddings, masked by attention
        let mut pooled = vec![0f32; hidden_dim];
        for i in 0..seq_len {
            if attn_mask[i] == 1 {
                for j in 0..hidden_dim {
                    pooled[j] += flat_data[i * hidden_dim + j];
                }
            }
        }
        let count = attn_mask.iter().filter(|&&m| m == 1).count() as f32;
        if count > 0.0 {
            for v in &mut pooled {
                *v /= count;
            }
        }

        // L2 normalize
        let norm: f32 = pooled.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for v in &mut pooled {
                *v /= norm;
            }
        }

        Ok(pooled)
    }
}
