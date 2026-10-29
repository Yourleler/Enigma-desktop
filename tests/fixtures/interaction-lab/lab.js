document.querySelector('#order').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const data=Object.fromEntries(new FormData(form));
  if(!data.name||!data.color||data.accepted!=='on'){document.querySelector('#receipt').textContent='请填写姓名、颜色并勾选确认。';return;}
  const button=form.querySelector('button');button.disabled=true;button.textContent='正在生成…';
  const response=await fetch('/receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json();document.querySelector('#receipt').textContent=`回执已生成\n姓名：${data.name}\n数量：${data.quantity}\n颜色：${data.color}\n备注：${data.note}\n编号：${result.id}`;
  button.disabled=false;button.textContent='生成测试回执';
});
document.querySelector('#delayed').onclick=()=>setTimeout(()=>{document.querySelector('#dynamic').innerHTML='<label>延迟出现的输入框 <input aria-label="延迟出现的输入框"></label>';},650);
document.querySelector('#modal').onclick=()=>document.querySelector('dialog').showModal();
document.querySelector('#close-modal').onclick=()=>document.querySelector('dialog').close();
document.querySelector('#changing').onclick=()=>{document.querySelector('#action-result').textContent='保存按钮已点击';};
document.querySelector('#replace').onclick=()=>{
  const next=document.createElement('button');next.id='changing';next.textContent='清除测试记录';next.onclick=()=>{document.querySelector('#action-result').textContent='清除按钮已点击';};
  document.querySelector('#changing').replaceWith(next);
};
document.querySelector('#upload').onchange=async event=>{
  const file=event.target.files[0];if(file)document.querySelector('#upload-result').textContent=`已读取 ${file.name}\n${(await file.text()).slice(0,1000)}`;
};
document.querySelector('#click-surface').ondblclick=()=>{document.querySelector('#pointer-result').textContent='双击成功';};
document.querySelector('#card').ondragstart=event=>{event.dataTransfer.setData('text/plain','new-test-card');document.querySelector('#pointer-result').textContent='拖拽已开始';};
document.querySelector('#drop').ondragover=event=>event.preventDefault();
document.querySelector('#drop').ondrop=event=>{event.preventDefault();if(event.dataTransfer.getData('text/plain')==='new-test-card')document.querySelector('#pointer-result').textContent='拖拽成功';};
document.querySelector('#fixed').onclick=()=>{document.querySelector('#fixed-result').textContent='固定按钮已点击';};
const hoverResult = document.createElement('output'); hoverResult.id = 'hover-result'; document.querySelector('#click-surface').after(hoverResult);
document.querySelector('#click-surface').onmouseenter=()=>{hoverResult.textContent='悬停成功';};
