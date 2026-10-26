import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function hashPassword(password:string){
 const salt=randomBytes(16).toString('hex');
 const hash=await scrypt(password,salt,64) as Buffer;
 return `${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password:string,encoded:string){
 const [salt,hash]=encoded.split(':');if(!salt||!hash)return false;
 const actual=await scrypt(password,salt,64) as Buffer;const expected=Buffer.from(hash,'hex');
 return expected.length===actual.length&&timingSafeEqual(actual,expected);
}
