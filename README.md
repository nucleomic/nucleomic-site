# Nucleomic AB1 Analyzer

[![DOI](https://zenodo.org/badge/1212055708.svg)](https://doi.org/10.5281/zenodo.19672829)

Nucleomic AB1 Analyzer is a web-based platform for preprocessing `.ab1` Sanger sequencing files, exporting FASTA output, running multiple sequence alignment (MSA), and generating phylogenetic trees.

This repository contains the FastAPI backend, static frontend, Redis-backed queue workflow, worker services, and deployment templates used to run the application.

## Features

- Upload and preprocess `.ab1` files
- Apply quality-threshold based filtering
- Support gap, mask, and delete modes for low-quality bases
- Export processed sequences as FASTA
- Run MSA workflows with external alignment tools
- Generate phylogenetic trees with external tree-building tools
- Handle long-running jobs asynchronously via Redis workers

## Repository Structure

```text
app/                FastAPI app, routers, workers, settings, services
frontend/           Static frontend assets (HTML, CSS, JS, logos)
deploy/             Nginx and systemd deployment templates
scripts/            Utility scripts for local testing
requirements.txt    Python dependencies
.env.example        Example environment configuration
```

## Requirements

- Python 3.11+
- Redis
- External command-line tools for MSA / tree generation
  - MUSCLE
  - ClustalW
  - IQ-TREE

## Quick Start

### 1) Create a virtual environment

**Windows PowerShell**

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

**Linux / macOS**

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2) Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3) Configure environment variables

Create a `.env` file in the repository root based on `.env.example`.

### 4) Start Redis

The queue-based workflow requires Redis.

### 5) Start the API server

```bash
uvicorn app.main:app --reload
```

### 6) Start the MSA / tree worker

In a separate terminal:

```bash
python -m app.workers.msa_tree_worker
```

### 7) Start the cleanup worker

In another terminal:

```bash
python -m app.workers.cleanup_worker
```

## Deployment

Production deployment is designed around:

- FastAPI
- Redis
- Nginx
- systemd services

Deployment templates are included under:

- `deploy/nginx/`
- `deploy/systemd/`

A typical production target path is:

```text
/opt/nucleomic
```

## External Tools

To keep licensing and redistribution clean, this repository is intended to reference third-party tools as external runtime dependencies rather than bundling their binaries directly into Git.

Set explicit paths using environment variables when needed:

```env
MUSCLE_BIN=/usr/local/bin/muscle
CLUSTALW_BIN=/usr/local/bin/clustalw
IQTREE_BIN=/usr/local/bin/iqtree3
```

## Security

If you discover a security vulnerability, please follow the instructions in `SECURITY.md`.

## Citation

If you use this software in academic work, please cite it using the metadata in `CITATION.cff`.

## License

This project is licensed under the Apache License 2.0. See `LICENSE` for details.
