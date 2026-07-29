import pypdf
import os

pdf_path = 'PesTrack Issues and new features 20 jul 26.pdf'
if not os.path.exists(pdf_path):
    print("PDF not found!")
    exit(1)

reader = pypdf.PdfReader(pdf_path)
print(f"Total Pages: {len(reader.pages)}")

for i, page in enumerate(reader.pages):
    text = page.extract_text()
    print(f"\n--- Page {i+1} ---")
    print(text)
