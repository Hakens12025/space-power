# -*- coding: utf-8 -*-
import torch, time
print('torch', torch.__version__)
try:
    import triton; print('triton', triton.__version__)
except Exception as e:
    print('triton 不可用:', str(e)[:60])
def f(a,b):
    for _ in range(20):
        a = torch.where(a>b, a*1.001, a-b*0.5); b = torch.tanh(a)+b*0.999
    return a+b
x=torch.randn(24576,3,device='cuda'); y=torch.randn(24576,3,device='cuda')
try:
    g=torch.compile(f)
    t0=time.time(); g(x,y); torch.cuda.synchronize()
    print('torch.compile 首次编译 %.1fs'%(time.time()-t0))
    torch.cuda.synchronize(); t0=time.time()
    for _ in range(50): g(x,y)
    torch.cuda.synchronize(); print('compile 后 %.3f ms/次'%((time.time()-t0)/50*1000))
except Exception as e:
    print('torch.compile 失败:', str(e)[:120])
torch.cuda.synchronize(); t0=time.time()
for _ in range(50): f(x,y)
torch.cuda.synchronize(); print('eager     %.3f ms/次'%((time.time()-t0)/50*1000))
# CUDA Graph 对照
try:
    sx=x.clone(); sy=y.clone()
    s=torch.cuda.Stream(); s.wait_stream(torch.cuda.current_stream())
    with torch.cuda.stream(s):
        for _ in range(3): out=f(sx,sy)
    torch.cuda.current_stream().wait_stream(s)
    gph=torch.cuda.CUDAGraph()
    with torch.cuda.graph(gph): out=f(sx,sy)
    torch.cuda.synchronize(); t0=time.time()
    for _ in range(50): gph.replay()
    torch.cuda.synchronize(); print('CUDA Graph %.3f ms/次'%((time.time()-t0)/50*1000))
except Exception as e:
    print('CUDA Graph 失败:', str(e)[:120])
