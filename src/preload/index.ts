import { contextBridge, ipcRenderer } from "electron";
import { createApi } from "../shared/client-api.ts";
import { IpcChannel as C } from "../shared/ipc.ts";
contextBridge.exposeInMainWorld("rallyLocal",createApi(ipcRenderer));
contextBridge.exposeInMainWorld("rallyConnection",{
 state:()=>ipcRenderer.invoke(C.connectionState),
 select:(mode:string,url:string,key:string)=>ipcRenderer.invoke(C.connectionSelect,mode,url,key),
 request:(endpoint:string,body:unknown)=>ipcRenderer.invoke(C.connectionRequest,endpoint,body),
 upload:(id:string,offset:number,bytes:Uint8Array)=>ipcRenderer.invoke(C.connectionUpload,id,offset,bytes),
 saveResource:(id:string,downloadId:string)=>ipcRenderer.invoke(C.connectionSave,id,downloadId),
 cancelSave:(id:string)=>ipcRenderer.invoke(C.connectionCancelSave,id),
});
