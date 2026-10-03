"""
Compile endpoint tests.
Test the /api/compile endpoint with valid and invalid inputs.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_compile_simple_document():
    """Test compiling a simple LaTeX document."""
    response = client.post(
        "/api/compile/",
        json={
            "files": {
                "main.tex": "\\documentclass{article}\n\\begin{document}\nHello, World!\n\\end{document}"
            }
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["success"] is True
    assert data["pdf"] is not None  # Base64-encoded PDF
    assert data["log"] != ""
    assert data["compile_time"] > 0


def test_compile_no_files():
    """Test compile with no files returns 400."""
    response = client.post(
        "/api/compile/",
        json={"files": {}}
    )
    
    assert response.status_code == 400
    assert "No files provided" in response.json()["detail"]


def test_compile_no_tex_file():
    """Test compile with no .tex file returns 400."""
    response = client.post(
        "/api/compile/",
        json={
            "files": {
                "readme.md": "# Hello"
            }
        }
    )
    
    assert response.status_code == 400
    assert ".tex file" in response.json()["detail"]


def test_compile_with_error():
    """Test compiling document with LaTeX error."""
    response = client.post(
        "/api/compile/",
        json={
            "files": {
                "main.tex": "\\documentclass{article}\n\\begin{document}\n\\badcommand\n\\end{document}"
            }
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # Should fail compilation but return 200 with error details
    assert data["success"] is False
    assert data["errors"] or data["error"]  # Has error information


def test_compile_with_bib():
    """Test compiling document with BibTeX."""
    response = client.post(
        "/api/compile/",
        json={
            "files": {
                "main.tex": """
\\documentclass{article}
\\begin{document}
Hello World \\cite{test}
\\bibliographystyle{plain}
\\bibliography{refs}
\\end{document}
""",
                "refs.bib": """
@article{test,
  title={Test Article},
  author={Author},
  year={2024}
}
"""
            }
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


def test_compile_health_endpoint():
    """Test /api/compile/health endpoint."""
    response = client.get("/api/compile/health")
    
    assert response.status_code == 200
    data = response.json()
    
    assert "status" in data
    assert "compiler" in data
    
    # Should be healthy if Docker image is built
    if data["compiler"] == "available":
        assert data["status"] == "healthy"


@pytest.mark.slow
def test_compile_large_document():
    """Test compiling a larger document (takes longer)."""
    # Generate large document
    large_tex = "\\documentclass{article}\n\\begin{document}\n"
    for i in range(100):
        large_tex += f"Section {i}\\\\\\n"
    large_tex += "\\end{document}"
    
    response = client.post(
        "/api/compile/",
        json={
            "files": {
                "main.tex": large_tex
            }
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


@pytest.mark.parametrize("filename", [
    "document.tex",
    "thesis.tex",
    "paper.tex",
])
def test_compile_different_filenames(filename):
    """Test compiling with different main file names."""
    response = client.post(
        "/api/compile/",
        json={
            "files": {
                filename: "\\documentclass{article}\\begin{document}Test\\end{document}"
            }
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
