import {createClient} from "npm:@supabase/supabase-js@2";
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const headers={"Access-Control-Allow-Origin":"https://webdata6432.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type","Cache-Control":"no-store"};
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers});
 const token=req.headers.get("Authorization")?.replace(/^Bearer /,"");
 if(!token)return new Response(null,{status:401,headers});
 const {data:{user}}=await admin.auth.getUser(token);
 if(!user?.email_confirmed_at||user.email?.toLowerCase()!=="webdata6432@gmail.com")return new Response(null,{status:403,headers});
 try{
 const {data,error}=await admin.from("site_unlock_secret").select("pem").eq("id",1).single();if(error)throw error;
 const key=await crypto.subtle.importKey("pkcs8",bytes(data.pem.replace(/-----[^-]+-----|\s/g,"")),{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
 const wrapped=await req.text();if(wrapped.length>400)throw Error();
 const raw=await crypto.subtle.decrypt("RSA-OAEP",key,bytes(wrapped));
 return new Response(btoa(String.fromCharCode(...new Uint8Array(raw))),{headers});
 }catch{return new Response(null,{status:400,headers})}
});
