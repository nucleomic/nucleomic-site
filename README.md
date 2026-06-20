# Nucleomic AB1 Analyzer

[![DOI](https://zenodo.org/badge/1212055708.svg)](https://doi.org/10.5281/zenodo.19672829)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-beta-orange.svg)](https://www.nucleomic.com)

**Nucleomic AB1 Analyzer** is an open-source, web-based platform for preprocessing Sanger sequencing chromatograms, exporting processed sequences, generating multiple sequence alignments, and performing phylogenetic analyses.

The platform combines `.ab1` preprocessing, sequence alignment, phylogenetic inference, job management, and result visualization in a browser-based workflow.

**Live application:** [www.nucleomic.com](https://www.nucleomic.com)

> Nucleomic AB1 Analyzer is currently in beta. It is intended for research and educational use and has not yet undergone peer-reviewed validation. It is not intended for clinical or diagnostic use.

## Features

### AB1 preprocessing

* Upload one or more `.ab1` Sanger sequencing files
* Read base calls and Phred quality scores
* Apply a user-defined quality threshold
* Handle low-quality bases using:

  * gap replacement (`-`)
  * ambiguous-base masking (`N`)
  * base deletion
* Apply optional positional selection
* Export processed sequences in FASTA format

### Multiple sequence alignment

Supported alignment engines:

* MUSCLE
* ClustalW

Aligned sequences can be reviewed in the browser and downloaded as FASTA.

### Phylogenetic analysis

Supported tree-building methods:

* Maximum Likelihood
* Neighbor Joining
* UPGMA

#### Maximum Likelihood

Maximum Likelihood analyses are performed with IQ-TREE.

Available options include:

* automatic substitution-model selection
* predefined substitution models exposed by the interface
* standard nonparametric bootstrap
* ultrafast bootstrap

Bootstrap and ultrafast-bootstrap support estimation currently apply to Maximum Likelihood analyses.

#### Neighbor Joining and UPGMA

Distance-based analyses support:

* Kimura 2-parameter
* Jukes–Cantor
* p-distance
* identity
* blastn
* trans

NJ and UPGMA trees are generated from the selected distance matrix.

### Analysis warnings

The platform can report warnings for conditions that may reduce phylogenetic informativeness, including:

* low sequence count
* short alignments
* high gap proportions
* very low sequence divergence
* identical or redundant sequences
* the ultrametric assumption associated with UPGMA

These warnings are interpretive aids and do not replace expert evaluation of the alignment and inferred tree.

### Results and exports

Depending on the selected workflow, users can obtain:

* processed FASTA sequences
* aligned FASTA files
* Newick tree files
* analysis summaries
* method and model information
* support settings
* input and alignment summaries
* analysis warnings
* provenance metadata

### Asynchronous job processing

Long-running MSA and phylogenetic analyses are handled through a Redis-backed queue.

The platform includes:

* background analysis workers
* job status tracking
* queue and running-state updates
* job cancellation support
* configurable command timeouts
* configurable result expiration
* a cleanup worker for temporary job data

## Scientific scope

Nucleomic is designed to make common Sanger sequence-processing and phylogenetic-analysis steps accessible through a unified interface.

Users remain responsible for:

* evaluating chromatogram quality
* selecting biologically appropriate sequences
* reviewing the resulting alignment
* selecting suitable evolutionary models
* determining whether the dataset contains sufficient phylogenetic signal
* interpreting branch lengths and support values
* independently validating results used in publications

The platform does not guarantee that an inferred tree represents the true evolutionary history of the analyzed sequences.

## Repository structure

```text
app/
├── core/               Application settings and shared configuration
├── routers/            FastAPI API routes
├── services/           AB1, alignment, tree, queue, and result logic
└── workers/            Background analysis and cleanup workers

frontend/               Static user interface assets
deploy/                 Nginx and systemd deployment templates
scripts/                Local development and utility scripts
requirements.txt        Python dependencies
.env.example            Example environment configuration
CITATION.cff            Citation metadata
SECURITY.md             Security reporting policy
THIRD_PARTY_NOTICES.md  Third-party software information
```

## Requirements

* Python 3.11 or later
* Redis
* MUSCLE
* ClustalW
* IQ-TREE 3

External analysis tools are runtime dependencies and are not distributed as part of this repository.

## Installation

### 1. Clone the repository

```bash
git clone git@github.com:nucleomic/nucleomic-site.git
cd nucleomic-site
```

### 2. Create a virtual environment

Linux or macOS:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure the environment

Create a local `.env` file from the example configuration:

```bash
cp .env.example .env
```

On Windows:

```powershell
Copy-Item .env.example .env
```

Configure Redis, storage, allowed origins, command timeouts, and external-tool paths as required.

Example external-tool configuration:

```env
MUSCLE_BIN=/usr/local/bin/muscle
CLUSTALW_BIN=/usr/local/bin/clustalw
IQTREE_BIN=/usr/local/bin/iqtree3
```

### 5. Start Redis

The queue-based workflow requires an accessible Redis instance.

The default configuration is:

```env
REDIS_URL=redis://127.0.0.1:6379/0
```

### 6. Start the API server

```bash
uvicorn app.main:app --reload
```

### 7. Start the analysis worker

In a separate terminal:

```bash
python -m app.workers.msa_tree_worker
```

### 8. Start the cleanup worker

In another terminal:

```bash
python -m app.workers.cleanup_worker
```

## Production deployment

The included deployment templates use:

* FastAPI
* Redis
* Nginx
* systemd

Templates are located under:

```text
deploy/nginx/
deploy/systemd/
```

The default production layout assumes:

```text
/opt/nucleomic
```

Deployment paths, service users, permissions, allowed origins, and environment variables should be adapted to the target system.

## External tools

MUSCLE, ClustalW, and IQ-TREE are separate third-party projects with their own licenses and citation requirements.

This repository references these programs as external runtime dependencies rather than redistributing their executable files.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for additional information.

## Data handling

Uploaded sequences and generated results are processed for the requested analysis workflow.

Temporary job data and result retention are controlled by the deployment configuration, including:

```env
RESULT_TTL_SECONDS
STORAGE_ROOT
JOB_TIMEOUT_SECONDS
STALE_RUNNING_SECONDS
```

Operators hosting their own instance are responsible for configuring storage, retention, access control, backups, logging, and deletion policies appropriately.

For the public Nucleomic service, consult the privacy policy available on the website.

## Security

Do not report security vulnerabilities through public GitHub issues.

Follow the instructions in [`SECURITY.md`](SECURITY.md) to report a potential vulnerability privately.

## Citation

When using Nucleomic AB1 Analyzer in academic work, cite the software using the metadata provided in [`CITATION.cff`](CITATION.cff).

A DOI-archived software record is also available through Zenodo.

## Contributing

Bug reports, feature requests, documentation improvements, and reproducible test cases are welcome through GitHub Issues.

When reporting an analysis problem, avoid publicly uploading confidential, unpublished, clinical, or personally identifiable sequence data.

## License

Nucleomic AB1 Analyzer is licensed under the [Apache License 2.0](LICENSE).

Copyright © 2026 İlteriş Eren Amil / Nucleomic.
