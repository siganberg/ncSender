using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IToolService
{
    /// <summary>The tools as tool changes see them (what M6 T&lt;n&gt; loads); see Tool Numbering.</summary>
    Task<List<ToolInfo>> GetAllAsync();
    /// <summary>The stored Tool Library, as the Tool Library tab edits it.</summary>
    Task<List<ToolInfo>> GetLibraryAsync();
    /// <summary>Writes offsets onto a stored tool and nothing else; null if nothing is stored.</summary>
    Task<ToolInfo?> UpdateOffsetsAsync(int id, double? tlo = null, double? x = null, double? y = null, double? z = null);
    Task<ToolInfo?> GetByIdAsync(int id);
    Task<ToolInfo> AddAsync(ToolInfo tool);
    Task<ToolInfo?> UpdateAsync(int id, ToolInfo tool);
    Task<bool> DeleteAsync(int id);
    Task BulkUpdateAsync(List<ToolInfo> tools);
}
