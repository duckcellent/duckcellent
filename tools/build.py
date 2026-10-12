# Builds index.html from src/template_saas.html.   Run from the project folder:  python3 tools/build.py
import os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..'))
s=open('src/template_saas.html',encoding='utf8').read()
for k,f in (('COUNTRIES','countries.js'),('MAPDATA','mapdata.js'),('AIRPORTS','airports.js')):
    s=s.replace('/*@%s@*/'%k,open('src/'+f,encoding='utf8').read())
head=open('tools/page_head.html',encoding='utf8').read()
tail=open('tools/page_tail.html',encoding='utf8').read()
open('index.html','w',encoding='utf8').write(head+s+'\n'+tail)
print('index.html',os.path.getsize('index.html'))
