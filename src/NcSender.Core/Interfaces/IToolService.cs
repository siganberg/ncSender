using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IToolService
{
    Task<List<ToolInfo>> GetAllAsync();
    Task<ToolInfo?> GetByIdAsync(int id);
    Task<ToolInfo> AddAsync(ToolInfo tool);
    Task<ToolInfo?> UpdateAsync(int id, ToolInfo tool);
    Task<bool> DeleteAsync(int id);
    Task BulkUpdateAsync(List<ToolInfo> tools);
}
