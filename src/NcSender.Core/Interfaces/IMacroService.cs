using NcSender.Core.Models;

namespace NcSender.Core.Interfaces;

public interface IMacroService
{
    List<MacroInfo> ListMacros();
    MacroInfo? GetMacro(int id);
    Task<MacroInfo> CreateMacroAsync(MacroInfo macro);
    Task<MacroInfo?> UpdateMacroAsync(int id, MacroInfo macro);
    Task<bool> DeleteMacroAsync(int id);
    (int nextId, int minId, int maxId) GetNextAvailableId();
}
