# Domain: Machine Learning Engineering (ML-ENG)

## Core Philosophy
- **Data-Centric AI:** Quality and diversity of data are the primary drivers of model performance.
- **Reproducibility:** Every experiment, pipeline, and training run must be fully reproducible.
- **Continuous Monitoring:** Model performance and data drift must be monitored throughout the lifecycle.

## Implementation Rules
- **Pipelines:** Build versioned data pipelines for collection, cleaning, and feature engineering (DVC/MLflow).
- **Training:** Use standardized frameworks (PyTorch, TensorFlow) and rigorously track all hyperparameters.
- **Evaluation:** Select appropriate metrics (Precision/Recall, RMSE) and use cross-validation strategies.
- **Inference:** Optimize for target environments (ONNX, TensorRT, vLLM) and implement efficient serving layers.

## MLOps
- **Vector Databases:** Use vector stores (Pinecone, Qdrant) for RAG and similarity-based retrieval.
- **Ethics:** Proactively identify and mitigate bias in datasets and model predictions.
- **Versioning:** Version control models and datasets as core artifacts alongside code.
