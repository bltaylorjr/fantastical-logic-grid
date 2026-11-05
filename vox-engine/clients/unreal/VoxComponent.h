// Vox voice engine client for Unreal Engine 5. Free to use in any project.
//
// Setup:
//   1. Copy VoxComponent.h / VoxComponent.cpp into your project's Source/<Game>/ folder.
//   2. In <Game>.Build.cs add:  PublicDependencyModuleNames.AddRange(new[] { "HTTP", "Json" });
//   3. Rebuild, add the "Vox" component to an actor, start the server: vox serve --ckpt vox.pt
//
// Blueprint:  Speak(Text, Voice, Emotion, Intensity)  -> plays on the owner, fires OnLineReady
// C++:        Vox->Speak(TEXT("Halt!"), TEXT("guard"), TEXT("angry"), 0.7f);
//             TranslateTo = "es" (any language code) translates the line first.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Interfaces/IHttpRequest.h"
#include "VoxComponent.generated.h"

class USoundWaveProcedural;
class UAudioComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FVoxLineReady, USoundWave*, Sound, const FString&, Take, float, Duration);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FVoxLineFailed, const FString&, Message);

UCLASS(ClassGroup = (Audio), meta = (BlueprintSpawnableComponent), DisplayName = "Vox")
class UVoxComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Vox")
	FString ServerUrl = TEXT("http://127.0.0.1:5150");

	/** Play automatically at the owning actor's location when the line arrives. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Vox")
	bool bAutoPlay = true;

	UPROPERTY(BlueprintAssignable, Category = "Vox")
	FVoxLineReady OnLineReady;

	UPROPERTY(BlueprintAssignable, Category = "Vox")
	FVoxLineFailed OnLineFailed;

	/** Generate and play a line. Emotion may be empty. Seed -1 = random. */
	UFUNCTION(BlueprintCallable, Category = "Vox")
	void Speak(const FString& Text, const FString& Voice = TEXT("narrator"), const FString& Emotion = TEXT(""),
	           float Intensity = 1.f, float Rate = 0.f, float Pitch = 0.f, const FString& StylePrompt = TEXT(""),
	           int32 Seed = -1, const FString& TranslateTo = TEXT(""), float Enunciate = 0.f);

	/** Replace words in a previous line (Take comes from OnLineReady). */
	UFUNCTION(BlueprintCallable, Category = "Vox")
	void ReplaceWords(const FString& Take, const FString& OldWords, const FString& NewWords);

	/** Undo the last edit of a take. */
	UFUNCTION(BlueprintCallable, Category = "Vox")
	void Undo(const FString& Take);

private:
	void PostJson(const FString& Path, const FString& Body);
	void OnResponse(FHttpRequestPtr Req, FHttpResponsePtr Resp, bool bOk);

	UPROPERTY()
	TObjectPtr<UAudioComponent> AudioComp;
};
