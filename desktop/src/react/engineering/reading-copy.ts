export const readingRoles:Record<string,string>={entry:'入口',contract:'接口契约',implementation:'实现',consumer:'调用方',test:'测试',configuration:'配置',documentation:'文档'};
export function readingText(value:string=''){
 const stale=/^Project material (.+) is stale\.$/.exec(value);if(stale)return `项目资料 ${stale[1]} 已过期，请重新核对来源。`;
 const imported=/^Imported material (.+) has not been revalidated against its remote source\.$/.exec(value);if(imported)return `导入资料 ${imported[1]} 尚未与远端来源重新核对。`;
 const outline=/^Symbol outlines examined (\d+) of (\d+) candidate files; remaining changes retain per-file coverage\.$/.exec(value);
 if(outline)return `已检查 ${outline[1]} / ${outline[2]} 个候选文件的符号入口；其余文件的片段状态列在逐文件范围中。`;
 const missing=/^(\d+) changed files have no readable source excerpt; inspect the per-file coverage and full diff\.$/.exec(value);
 if(missing)return `${missing[1]} 个变更文件未取得文本片段，请核对逐文件范围及全量 Diff。`;
 const grouping=/^(chapters|layers): (\d+) published source nodes are not included in the chosen grouping; they remain available in the full map\.$/.exec(value);
 if(grouping)return `当前${grouping[1]==='chapters'?'章节':'分层'}未包含 ${grouping[2]} 个已记录节点；可在完整关系图中查看。`;
 const step=/^Suggested (\w+) reading; source location and relation can be checked independently\.$/.exec(value);
 if(step)return `建议查看${readingRoles[step[1]]||step[1]}；请结合实际源码与关系核对。`;
 const chapter=/^Source-backed (\w+) locations; expand each node for actual code\.$/.exec(value);
 if(chapter)return `这些${readingRoles[chapter[1]]||chapter[1]}位置来自源码；展开片段可查看依据。`;
 return value.replace('No explicit expected change scope; nonexpected changes cannot be decided from goal wording alone.','没有给出明确的预期修改范围，不能仅凭目标措辞判断哪些改动越界。')
  .replace('Further source expansion remains outside the query budget.','还有源码关系未在本次查询额度内展开。')
  .replace('No source query could be derived; provide entry symbols or a diff baseline.','未能提取符号入口；文件片段不等于符号关系分析。')
  .replace('Repository responsibility declared by the workspace; not an inferred runtime architecture.','仓库职责来自项目登记，不是推断出的运行架构。')
  .replace('Call target not resolved statically:','无法静态确定调用目标：')
  .replace('No resolved source definition for','没有找到可确定的源码定义：')
  .replace('Unavailable file excerpt:','文件片段无法读取：')
  .replace('Binary or source reading budget exceeded','二进制文件或超出源码读取预算')
  .replace('Non-UTF8 source','文件不是 UTF-8 文本')
  .replace('Nonregular Git object; retained in diff metadata only','非普通 Git 文件，仅保留差异元数据')
  .replace('File exceeds reading budget','文件超过读取预算')
  .replace(': reading budget', '：超过读取预算')
  .replace('Outline budget exceeded:','符号入口超过读取预算：')
  .replace('Could not outline ','无法提取符号入口：');
}
