import zipfile
import xml.etree.ElementTree as ET
import os

def read_docx(file_path):
    if not os.path.exists(file_path):
        return f"File not found: {file_path}"
    
    try:
        with zipfile.ZipFile(file_path) as z:
            xml_content = z.read('word/document.xml')
            root = ET.fromstring(xml_content)
            
            # The XML namespaces
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            
            # Find all paragraph elements
            paragraphs = []
            for para in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                # Extract text from text elements inside paragraph
                text_elems = para.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')
                text = "".join([t.text for t in text_elems if t.text])
                if text.strip():
                    paragraphs.append(text)
            
            return "\n".join(paragraphs)
    except Exception as e:
        return f"Error reading {file_path}: {e}"

files = [
    'Data persistence in the Parcel Mapping.docx',
    'PesTrack_Technical_Documentation.docx'
]

for f in files:
    print(f"\n========================================\nFile: {f}\n")
    print(read_docx(f))
