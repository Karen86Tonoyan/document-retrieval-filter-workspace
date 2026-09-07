from setuptools import setup, find_packages

setup(
    name="filtry-tonoyana",
    version="3.0.0rc1",
    description="Anti-Hallucination & Semantic Safety Stack for LLM outputs",
    long_description=open("README.md").read() if __import__("os").path.exists("README.md") else "",
    author="Karen Tonoyan",
    author_email="kontakt@karentonoyan.pl",
    url="https://karentonoyan.pl",
    packages=find_packages(),
    python_requires=">=3.11",
    install_requires=[],
    extras_require={
        "dev": ["pytest>=7.0"],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)
