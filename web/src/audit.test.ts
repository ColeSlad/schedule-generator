import {describe,it,expect} from 'vitest';
import {parseAudit} from './audit';
const audit=`Program Code 07010 Catalog Year Fall 2025
Cumulative Credits*: 7
Cumulative GPA: 3.4
7.0 CREDITS COMPLETED
IN-P ---> 3.0 CREDITS
Major GPA
Sp24 CMSC131 4.00 TP COMPUTER SCIENCE
Fa25 CMSC132 3.00 B+ PROGRAMMING
Fa26 CMSC330 3.00 IP LANGUAGES
Humanities (DSHU)
NEEDS: 1 COURSE
General Elective Courses
Fa25 CMSC132 3.00 B+ PROGRAMMING
Unused Courses
Sp24 XMATH113 0.00 TA tna PRECALCULUS
END OF ANALYSIS`;
describe('audit import',()=>{
 it('deduplicates listings, preserves transfer and pending credits',()=>{const p=parseAudit(audit);expect(p.attempts).toHaveLength(4);expect(p.credits_completed).toBe(7);expect(p.credits_in_progress).toBe(3);expect(p.attempts[0].transfer).toBe(true);expect(p.attempts[3].status).toBe('unused');expect(p.gened_remaining.DSHU).toBe(1);expect(p.issues.some(i=>i.includes('rows total'))).toBe(false)});
 it('flags inconsistent credit totals',()=>expect(parseAudit(audit.replace('Credits*: 7','Credits*: 9')).issues.some(i=>i.includes('rows total'))).toBe(true));
 it('rejects unrelated PDFs',()=>expect(()=>parseAudit('hello')).toThrow());
});
it('preserves plus/minus grades',()=>expect(parseAudit(audit).attempts.find(a=>a.course==='CMSC132')?.grade).toBe('B+'));
