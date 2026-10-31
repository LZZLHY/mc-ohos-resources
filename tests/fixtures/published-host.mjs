/** 隔离网络边界的完整公开HAP事实样本；不是实际发行或Native能力证明，禁止进入公开工具输入。 */
import {createHash} from 'node:crypto';
export function publishedHost({product='sideload',channel='stable',versionName=channel==='stable'?'2.0.0':'2.1.0-pre1',
  versionCode=2000000,runtimeHostProtocols=[1,2],runtimePlanProtocol=1,minApi=20,deviceTypes=['phone','tablet','2in1']}={}){
  const tag='v'+versionName,name='amcl-'+tag+'-'+product+'-unsigned.hap';
  const sha256=createHash('sha256').update('isolated-hap:'+product+'/'+versionName).digest('hex');
  return{schema:1,product,channel,source:'github',releaseKind:versionName.includes('-')?'preview':'stable',tag,versionName,versionCode,
    name,sha256,sizeBytes:1000,publicationId:createHash('sha256').update('isolated-publication:'+channel+'/'+sha256).digest('hex'),
    sourceRevision:'b'.repeat(40),websiteUrl:'https://amcl.lovedhy.cn/api/packages/files/'+sha256+'/'+name,
    minApi,abi:'arm64-v8a',deviceTypes,runtimeHostProtocols,runtimePlanProtocol};
}
