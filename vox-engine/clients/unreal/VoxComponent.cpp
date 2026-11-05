// Vox voice engine client for Unreal Engine 5. See VoxComponent.h for setup.
#include "VoxComponent.h"

#include "Components/AudioComponent.h"
#include "Dom/JsonObject.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Kismet/GameplayStatics.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Sound/SoundWaveProcedural.h"

static constexpr int32 VoxSampleRate = 24000;

void UVoxComponent::Speak(const FString& Text, const FString& Voice, const FString& Emotion, float Intensity,
                          float Rate, float Pitch, const FString& StylePrompt, int32 Seed,
                          const FString& TranslateTo, float Enunciate)
{
	TSharedRef<FJsonObject> J = MakeShared<FJsonObject>();
	J->SetStringField(TEXT("text"), Text);
	J->SetStringField(TEXT("voice"), Voice);
	if (!Emotion.IsEmpty()) J->SetStringField(TEXT("emotion"), Emotion);
	if (!StylePrompt.IsEmpty()) J->SetStringField(TEXT("style_prompt"), StylePrompt);
	J->SetNumberField(TEXT("intensity"), Intensity);
	J->SetNumberField(TEXT("rate"), Rate);
	J->SetNumberField(TEXT("pitch"), Pitch);
	if (Seed >= 0) J->SetNumberField(TEXT("seed"), Seed);
	if (!TranslateTo.IsEmpty()) J->SetStringField(TEXT("translate_to"), TranslateTo);
	if (Enunciate > 0.f) J->SetNumberField(TEXT("enunciate"), Enunciate);
	J->SetStringField(TEXT("format"), TEXT("pcm16"));
	FString Body;
	FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Body));
	PostJson(TEXT("/v1/speak"), Body);
}

void UVoxComponent::ReplaceWords(const FString& Take, const FString& OldWords, const FString& NewWords)
{
	TSharedRef<FJsonObject> Op = MakeShared<FJsonObject>();
	Op->SetStringField(TEXT("op"), TEXT("replace"));
	Op->SetStringField(TEXT("old"), OldWords);
	Op->SetStringField(TEXT("new"), NewWords);
	TSharedRef<FJsonObject> J = MakeShared<FJsonObject>();
	J->SetStringField(TEXT("take"), Take);
	TArray<TSharedPtr<FJsonValue>> Ops;
	Ops.Add(MakeShared<FJsonValueObject>(Op));
	J->SetArrayField(TEXT("ops"), Ops);
	FString Body;
	FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Body));
	PostJson(TEXT("/v1/edit"), Body);
}

void UVoxComponent::Undo(const FString& Take)
{
	PostJson(TEXT("/v1/edit"), FString::Printf(TEXT("{\"take\":\"%s\",\"ops\":[{\"op\":\"undo\"}]}"), *Take));
}

void UVoxComponent::PostJson(const FString& Path, const FString& Body)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(ServerUrl + Path);
	Req->SetVerb(TEXT("POST"));
	Req->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Req->SetContentAsString(Body);
	Req->OnProcessRequestComplete().BindUObject(this, &UVoxComponent::OnResponse);
	Req->ProcessRequest();
}

void UVoxComponent::OnResponse(FHttpRequestPtr Req, FHttpResponsePtr Resp, bool bOk)
{
	if (!bOk || !Resp.IsValid() || Resp->GetResponseCode() != 200)
	{
		const FString Msg = Resp.IsValid() ? Resp->GetContentAsString() : TEXT("Vox server not reachable");
		UE_LOG(LogTemp, Warning, TEXT("Vox: %s"), *Msg);
		OnLineFailed.Broadcast(Msg);
		return;
	}
	TArray<uint8> Data = Resp->GetContent();

	// Edits come back as WAV: strip the header down to the PCM "data" chunk.
	if (Data.Num() > 12 && Data[0] == 'R' && Data[1] == 'I' && Data[2] == 'F' && Data[3] == 'F')
	{
		int32 Pos = 12;
		while (Pos + 8 <= Data.Num())
		{
			const int32 Size = Data[Pos + 4] | (Data[Pos + 5] << 8) | (Data[Pos + 6] << 16) | (Data[Pos + 7] << 24);
			if (Data[Pos] == 'd' && Data[Pos + 1] == 'a' && Data[Pos + 2] == 't' && Data[Pos + 3] == 'a')
			{
				Data = TArray<uint8>(Data.GetData() + Pos + 8, FMath::Min(Size, Data.Num() - Pos - 8));
				break;
			}
			Pos += 8 + Size;
		}
	}

	USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>(this);
	Wave->SetSampleRate(VoxSampleRate);
	Wave->NumChannels = 1;
	Wave->Duration = Data.Num() / 2.f / VoxSampleRate;
	Wave->SoundGroup = SOUNDGROUP_Voice;
	Wave->bLooping = false;
	Wave->QueueAudio(Data.GetData(), Data.Num());

	const FString Take = Resp->GetHeader(TEXT("X-Vox-Take"));
	const float Duration = FCString::Atof(*Resp->GetHeader(TEXT("X-Vox-Duration")));

	if (bAutoPlay && GetOwner())
	{
		if (AudioComp && AudioComp->IsPlaying()) AudioComp->Stop();
		AudioComp = UGameplayStatics::SpawnSoundAttached(Wave, GetOwner()->GetRootComponent());
	}
	OnLineReady.Broadcast(Wave, Take, Duration);
}
