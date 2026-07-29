import zipfile
import xml.etree.ElementTree as ET
import os

def read_docx(file_path):
    try:
        with zipfile.ZipFile(file_path) as z:
            xml_content = z.read('word/document.xml')
            root = ET.fromstring(xml_content)
            paragraphs = []
            for para in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                text_elems = para.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')
                text = "".join([t.text for t in text_elems if t.text])
                if text.strip():
                    paragraphs.append(text)
            return "\n".join(paragraphs)
    except Exception as e:
        return f"Error reading {file_path}: {e}"

files = os.listdir('.')
print("All files in root:", files)

doc_files = [f for f in files if f.endswith('.docx')]
print("Docx files found:", doc_files)

for f in doc_files:
    print(f"\n========================================\nFile: {f}\n")
    print(read_docx(f)[:2000]) # Print first 2000 chars
