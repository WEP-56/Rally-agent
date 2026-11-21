import { contextBridge, ipcRenderer } from "electron";
import { createApi } from "../shared/client-api.ts";
import { IpcChannel as C } from "../shared/ipc.ts";
contextBridge.exposeInMainWorld("rallyLocal",createApi(ipcRenderer));
contextBridge.exposeInMainWorld("rallyConnection",{
 state:()=>ipcRenderer.invoke(C.connectionState),
 select:(mode:string,url:string,key:string)=>ipcRenderer.invoke(C.connectionSelect,mode,url,key),
 request:(endpoint:string,body:unknown)=>ipcRenderer.invoke(C.connectionRequest,endpoint,body),
});
